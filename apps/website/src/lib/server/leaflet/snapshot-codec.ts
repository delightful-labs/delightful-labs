import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseDocumentKey } from "./config";
import type { ConfiguredReader, Snapshot } from "./model";
import {
  articleMetadataSchema,
  httpsUrlSchema,
  ownerDidSchema,
  pdsUrlSchema,
  recordKeySchema,
} from "./schemas";

export const MAX_SNAPSHOT_BYTES = 10_000_000;
const persistedSnapshot = z.object({
  publication: z.object({
    uri: z.string(),
    name: z.string().min(1),
    sourceUrl: httpsUrlSchema,
  }),
  articles: z
    .array(
      articleMetadataSchema.extend({
        uri: z.string(),
        cid: z.string().min(1),
        key: recordKeySchema,
        description: z.string(),
        path: z.string(),
        sourceUrl: httpsUrlSchema,
        pds: pdsUrlSchema,
        document: z.object({ content: z.unknown(), authorDid: ownerDidSchema }),
      }),
    )
    .max(10_000),
  verifiedAt: z.number().int().nonnegative(),
  stale: z.literal(false),
});
const envelopeSchema = z.object({
  schemaVersion: z.literal(1),
  ownerDid: ownerDidSchema,
  publicationUri: z.string(),
  namespace: z.string(),
  revision: z.uuid(),
  snapshot: persistedSnapshot,
});

export function snapshotPath(
  config: ConfiguredReader,
  namespace: string,
): string {
  const hash = createHash("sha256")
    .update(JSON.stringify([namespace, config.ownerDid, config.publicationUri]))
    .digest("hex");
  return `leaflet/snapshots/v1/${hash}.json`;
}

export function decodeSnapshot(
  raw: unknown,
  config: ConfiguredReader,
  namespace: string,
): Snapshot {
  const value = envelopeSchema.parse(raw);
  if (
    value.ownerDid !== config.ownerDid ||
    value.publicationUri !== config.publicationUri ||
    value.namespace !== namespace ||
    value.snapshot.publication.uri !== config.publicationUri
  )
    throw new Error("Durable snapshot identity mismatch");
  const keys = new Set<string>();
  for (const article of value.snapshot.articles) {
    const key = parseDocumentKey(article.uri, config.ownerDid);
    if (
      key !== article.key ||
      article.path !== `/open-thoughts/${encodeURIComponent(key)}/` ||
      article.document.authorDid !== config.ownerDid ||
      keys.has(key)
    )
      throw new Error("Invalid durable article identity");
    keys.add(key);
  }

  return value.snapshot;
}

export function encodeSnapshot(
  snapshot: Snapshot,
  config: ConfiguredReader,
  namespace: string,
): string {
  const body = JSON.stringify({
    schemaVersion: 1,
    ownerDid: config.ownerDid,
    publicationUri: config.publicationUri,
    namespace,
    revision: randomUUID(),
    snapshot,
  });
  if (Buffer.byteLength(body) > MAX_SNAPSHOT_BYTES)
    throw new Error("Durable snapshot size limit");
  return body;
}
