import {
  array,
  normalizePages,
  object,
  string,
  type Page,
} from "../../leaflet/content";
import { readJson } from "./http";

export type ReaderConfig = { ownerDid: string; publicationUri?: string };
export type Article = {
  uri: string;
  cid: string;
  key: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  path: string;
  sourceUrl: string;
  pages: Page[];
};
export type Snapshot = {
  publication: { uri: string; name: string; sourceUrl: string };
  articles: Article[];
  verifiedAt: number;
  stale: boolean;
};
type Dependencies = {
  json?: (url: string) => Promise<unknown>;
  now?: () => number;
};

export class PublicationReader {
  private snapshot?: Snapshot;
  private pending?: Promise<Snapshot>;
  private json: (url: string) => Promise<unknown>;
  private now: () => number;
  private publicationKey?: string;
  constructor(
    private config: ReaderConfig,
    dependencies: Dependencies = {},
  ) {
    this.json = dependencies.json ?? readJson;
    this.now = dependencies.now ?? Date.now;
    if (!/^did:(plc|web):[A-Za-z0-9.:%_-]+$/.test(config.ownerDid))
      throw new Error("Invalid owner DID");
    if (config.publicationUri) {
      const match =
        /^at:\/\/(did:(?:plc|web):[^/]+)\/site\.standard\.publication\/([A-Za-z0-9_~:.-]+)$/.exec(
          config.publicationUri,
        );
      if (
        !match ||
        match[1] !== config.ownerDid ||
        [".", ".."].includes(match[2])
      )
        throw new Error("Invalid publication owner or URI");
      this.publicationKey = match[2];
    }
  }
  async read(): Promise<Snapshot | null> {
    if (!this.publicationKey) return null;
    if (this.snapshot && this.now() - this.snapshot.verifiedAt < 300_000)
      return this.snapshot;
    try {
      this.pending ??= this.refresh().finally(() => {
        this.pending = undefined;
      });
      const snapshot = await this.pending;
      this.snapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (this.snapshot && this.now() - this.snapshot.verifiedAt <= 86_400_000)
        return { ...this.snapshot, stale: true };
      throw error;
    }
  }
  private async refresh(): Promise<Snapshot> {
    const startedAt = this.now();
    const { ownerDid: did, publicationUri } = this.config;
    let identityUrl: string;
    if (did.startsWith("did:plc:"))
      identityUrl = `https://plc.directory/${encodeURIComponent(did)}`;
    else {
      const [host, ...path] = did.slice(8).split(":").map(decodeURIComponent);
      identityUrl = `https://${host}/${path.length ? `${path.map(encodeURIComponent).join("/")}/did.json` : ".well-known/did.json"}`;
    }
    const identity = object(await this.json(identityUrl));
    if (identity.id !== did) throw new Error("DID document mismatch");
    const service = array(identity.service)
      .map(object)
      .find(
        (s) =>
          string(s.id) === "#atproto_pds" ||
          string(s.id) === `${did}#atproto_pds`,
      );
    const endpoint = new URL(string(service?.serviceEndpoint));
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error("Invalid PDS service");
    const rpc = (method: string, params: Record<string, string>) => {
      if (this.now() - startedAt > 40_000) throw new Error("Archive refresh timeout");
      const url = new URL(`/xrpc/${method}`, endpoint);
      for (const [name, value] of Object.entries(params))
        url.searchParams.set(name, value);
      return this.json(url.href);
    };
    const before = object(
      await rpc("com.atproto.sync.getLatestCommit", { did }),
    );
    if (!string(before.cid)) throw new Error("Missing repository revision");
    const record = object(
      await rpc("com.atproto.repo.getRecord", {
        repo: did,
        collection: "site.standard.publication",
        rkey: this.publicationKey!,
      }),
    );
    if (record.uri !== publicationUri) throw new Error("Publication mismatch");
    const publication = object(record.value);
    const source = new URL(string(publication.url));
    if (source.protocol !== "https:" || !string(publication.name))
      throw new Error("Malformed publication");
    const records: unknown[] = [],
      cursors = new Set<string>();
    let cursor = "";
    do {
      const response = object(
        await rpc("com.atproto.repo.listRecords", {
          repo: did,
          collection: "site.standard.document",
          limit: "100",
          ...(cursor ? { cursor } : {}),
        }),
      );
      if (!Array.isArray(response.records))
        throw new Error("Malformed document response");
      records.push(...response.records);
      if (records.length > 10_000) throw new Error("Archive size limit");
      cursor = string(response.cursor);
      if (cursor && cursors.has(cursor)) throw new Error("Repeated cursor");
      if (cursor) cursors.add(cursor);
      if (cursors.size > 200) throw new Error("Pagination limit");
    } while (cursor);
    const articles: Article[] = [];
    const seen = new Set<string>();
    for (const raw of records) {
      const record = object(raw),
        doc = object(record.value);
      if (doc.site !== publicationUri) continue;
      const uri = string(record.uri),
        prefix = `at://${did}/site.standard.document/`;
      const key = uri.startsWith(prefix) ? uri.slice(prefix.length) : "";
      if (
        !/^[A-Za-z0-9_~:.-]+$/.test(key) ||
        [".", ".."].includes(key) ||
        seen.has(uri)
      )
        throw new Error("Invalid or duplicate record identity");
      seen.add(uri);
      const publishedAt = string(doc.publishedAt);
      if (!string(doc.title) || !Number.isFinite(Date.parse(publishedAt)))
        throw new Error("Malformed article metadata");
      const content = object(doc.content);
      let pages: unknown[];
      if (content.$type !== "pub.leaflet.content") pages = [{}];
      else if (content.blobPages) {
        const blob = object(content.blobPages),
          cid = string(object(blob.ref).$link);
        if (
          !/^b[a-z2-7]{10,}$/.test(cid) ||
          blob.mimeType !== "application/json" ||
          Number(blob.size) > 5_000_000
        )
          throw new Error("Malformed page blob");
        const decoded = await rpc("com.atproto.sync.getBlob", { did, cid });
        if (!Array.isArray(decoded)) throw new Error("Malformed blob pages");
        pages = decoded;
      } else {
        if (!Array.isArray(content.pages) || !content.pages.length)
          throw new Error("Missing article pages");
        pages = content.pages;
      }
      articles.push({
        uri,
        key,
        cid: string(record.cid),
        title: string(doc.title),
        description: string(doc.description),
        publishedAt,
        updatedAt: string(doc.updatedAt) || undefined,
        path: `/open-thoughts/${encodeURIComponent(key)}/`,
        sourceUrl: `https://leaflet.pub/lish/${encodeURIComponent(did)}/${encodeURIComponent(this.publicationKey!)}/${encodeURIComponent(key)}`,
        pages: normalizePages(pages, { did, pds: endpoint.origin }),
      });
    }
    const after = object(
      await rpc("com.atproto.sync.getLatestCommit", { did }),
    );
    if (before.cid !== after.cid)
      throw new Error("Repository changed during scan; retry later");
    articles.sort(
      (a, b) =>
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        a.uri.localeCompare(b.uri),
    );
    return {
      publication: {
        uri: publicationUri!,
        name: string(publication.name),
        sourceUrl: source.href,
      },
      articles,
      verifiedAt: this.now(),
      stale: false,
    };
  }
}
