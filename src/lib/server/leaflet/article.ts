import { object } from "../../leaflet/values";
import type { Rpc } from "./client";
import { parseDocumentKey } from "./config";
import type { Article, ConfiguredReader } from "./model";
import {
  articleMetadataSchema,
  contentSchema,
  pagesSchema,
  type DocumentRecord,
} from "./schemas";

async function readContent(
  raw: unknown,
  rpc: Rpc,
  did: string,
): Promise<unknown> {
  if (object(raw).$type !== "pub.leaflet.content") return raw;
  const content = contentSchema.parse(raw);
  const pages = content.blobPages
    ? await rpc("com.atproto.sync.getBlob", {
        did,
        cid: content.blobPages.ref.$link,
      })
    : content.pages;
  return { ...content, pages: pagesSchema.parse(pages) };
}

export async function readArticle(
  record: DocumentRecord,
  config: ConfiguredReader,
  pds: URL,
  rpc: Rpc,
): Promise<Article> {
  const key = parseDocumentKey(record.uri, config.ownerDid);
  const metadata = articleMetadataSchema.parse(record.value);
  const content = await readContent(record.value.content, rpc, config.ownerDid);
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
    document: {
      content,
      authorDid: config.ownerDid,
    },
    pds: pds.origin,
  };
}
