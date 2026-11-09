import {
  LEAFLET_AUTHOR_DID,
  LEAFLET_PUBLICATION_URI,
  SITE_ORIGIN,
} from "$app/env/private";
import { parseReaderConfig } from "./config";
import { PublicationReader } from "./reader";

const config = {
  ownerDid: LEAFLET_AUTHOR_DID,
  publicationUri: LEAFLET_PUBLICATION_URI || undefined,
};
let reader: PublicationReader | undefined;
export function publicationReader(): PublicationReader {
  return (reader ??= new PublicationReader(config));
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
