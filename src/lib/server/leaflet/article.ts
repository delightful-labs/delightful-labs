import { object } from "../../leaflet/values";
import { normalizePages } from "../../leaflet/pages";
import type { Rpc } from "./client";
import { parseDocumentKey } from "./config";
import type { Article, ConfiguredReader } from "./model";
import {
  articleMetadataSchema,
  contentSchema,
  pagesSchema,
  type DocumentRecord,
} from "./schemas";

async function readPages(
  raw: unknown,
  rpc: Rpc,
  did: string,
): Promise<unknown[]> {
  if (object(raw).$type !== "pub.leaflet.content") return [{}];
  const content = contentSchema.parse(raw);
  if (content.blobPages) {
    const cid = content.blobPages.ref.$link;
    return pagesSchema.parse(
      await rpc("com.atproto.sync.getBlob", { did, cid }),
    );
  }
  return pagesSchema.parse(content.pages);
}

export async function readArticle(
  record: DocumentRecord,
  config: ConfiguredReader,
  pds: URL,
  rpc: Rpc,
): Promise<Article> {
  const key = parseDocumentKey(record.uri, config.ownerDid);
  const metadata = articleMetadataSchema.parse(record.value);
  const pages = await readPages(record.value.content, rpc, config.ownerDid);
  return {
    uri: record.uri,
    cid: record.cid,
    key,
    title: metadata.title,
    description: metadata.description ?? "",
    publishedAt: metadata.publishedAt,
    updatedAt: metadata.updatedAt,
    path: `/open-thoughts/${encodeURIComponent(key)}/`,
    sourceUrl: `https://leaflet.pub/lish/${encodeURIComponent(config.ownerDid)}/${encodeURIComponent(config.publicationKey)}/${encodeURIComponent(key)}`,
    pages: normalizePages(pages, { did: config.ownerDid, pds: pds.origin }),
  };
}
