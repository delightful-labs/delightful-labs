import {
  LEAFLET_AUTHOR_DID,
  LEAFLET_PUBLICATION_URI,
  SITE_ORIGIN,
} from "$app/env/private";
import { PublicationReader } from "./reader";

export const OWNER_DID = "did:plc:226m7t4kp7d7sg2qsdresypm";
let reader: PublicationReader | undefined;
let identity = "";
export function publicationReader(): PublicationReader {
  const ownerDid = LEAFLET_AUTHOR_DID || OWNER_DID;
  const publicationUri = LEAFLET_PUBLICATION_URI || undefined;
  const key = JSON.stringify([ownerDid, publicationUri]);
  if (!reader || key !== identity) {
    reader = new PublicationReader({ ownerDid, publicationUri });
    identity = key;
  }
  return reader;
}
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
