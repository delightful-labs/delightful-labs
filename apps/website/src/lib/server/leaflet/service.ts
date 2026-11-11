import {
  LEAFLET_AUTHOR_DID,
  LEAFLET_PUBLICATION_URI,
  SITE_ORIGIN,
  BLOB_STORE_ID,
  VERCEL_ENV,
  VERCEL_GIT_COMMIT_REF,
} from "$app/env/private";
import { parseReaderConfig } from "./config";
import { PublicationReader } from "./reader";

const config = {
  ownerDid: LEAFLET_AUTHOR_DID,
  publicationUri: LEAFLET_PUBLICATION_URI || undefined,
};
let reader: PublicationReader | undefined;
export function publicationReader(): PublicationReader {
  if (!reader) {
    const parsed = parseReaderConfig(config);
    const namespace =
      VERCEL_ENV === "production"
        ? "production"
        : `${VERCEL_ENV}/${VERCEL_GIT_COMMIT_REF}`;
    const storage =
      parsed && BLOB_STORE_ID
        ? { storeId: BLOB_STORE_ID, namespace }
        : undefined;
    reader = new PublicationReader(config, storage);
  }
  return reader;
}
export function configuredPublicationUri(): string | undefined {
  return parseReaderConfig(config)?.publicationUri;
}

if (import.meta.hot) import.meta.hot.dispose(() => reader?.stop());
export function canonicalOrigin(): string {
  const url = new URL(SITE_ORIGIN);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid canonical origin");
  return url.origin;
}
