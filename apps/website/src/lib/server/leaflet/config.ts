import type { ConfiguredReader, ReaderConfig } from "./model";
import { ownerDidSchema, recordKeySchema } from "./schemas";

export function parseReaderConfig(
  config: ReaderConfig,
): ConfiguredReader | null {
  ownerDidSchema.parse(config.ownerDid);
  if (!config.publicationUri) return null;
  const match =
    /^at:\/\/(did:(?:plc|web):[^/]+)\/site\.standard\.publication\/([^/]+)$/.exec(
      config.publicationUri,
    );
  if (!match || match[1] !== config.ownerDid)
    throw new Error("Invalid publication owner or URI");
  return {
    ownerDid: config.ownerDid,
    publicationUri: config.publicationUri,
    publicationKey: recordKeySchema.parse(match[2]),
  };
}

export function parseDocumentKey(uri: string, ownerDid: string): string {
  const prefix = `at://${ownerDid}/site.standard.document/`;
  if (!uri.startsWith(prefix))
    throw new Error("Document owner or collection mismatch");
  return recordKeySchema.parse(uri.slice(prefix.length));
}
