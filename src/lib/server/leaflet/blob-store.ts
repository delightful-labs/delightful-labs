import { createHash, randomUUID } from "node:crypto";
import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
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
import type { SnapshotStore } from "./snapshot-store";

const MAX_BYTES = 10_000_000;
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

export function blobSnapshotStore(
  config: ConfiguredReader,
  storeId: string,
  namespace: string,
): SnapshotStore {
  const path = snapshotPath(config, namespace);
  const options = (signal: AbortSignal) => ({
    storeId,
    access: "private" as const,
    abortSignal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
  });
  const store: SnapshotStore = {
    async read(signal) {
      signal.throwIfAborted();
      const result = await get(path, { ...options(signal), useCache: false });
      if (!result) return null;
      if (result.statusCode !== 200)
        throw new Error("Unexpected snapshot response");
      let size = 0;
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.stream) {
        size += chunk.length;
        if (size > MAX_BYTES) throw new Error("Durable snapshot size limit");
        chunks.push(chunk);
      }
      const value = envelopeSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
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
      return { snapshot: value.snapshot, version: result.blob.etag };
    },
    async write(snapshot: Snapshot, version, signal) {
      signal.throwIfAborted();
      const body = JSON.stringify({
        schemaVersion: 1,
        ownerDid: config.ownerDid,
        publicationUri: config.publicationUri,
        namespace,
        revision: randomUUID(),
        snapshot,
      });
      if (Buffer.byteLength(body) > MAX_BYTES)
        throw new Error("Durable snapshot size limit");
      try {
        await put(path, body, {
          ...options(signal),
          addRandomSuffix: false,
          contentType: "application/json",
          cacheControlMaxAge: 60,
          allowOverwrite: version !== null,
          ...(version ? { ifMatch: version } : {}),
        });
        return true;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof BlobPreconditionFailedError) return false;
        // The API has no dedicated already-exists error for first-writer races.
        if (version === null && (await store.read(signal))) return false;
        throw error;
      }
    },
  };
  return store;
}
