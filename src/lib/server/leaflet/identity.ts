import type { JsonReader } from "./model";
import { identitySchema, pdsUrlSchema } from "./schemas";

function identityUrl(did: string): string {
  if (did.startsWith("did:plc:"))
    return `https://plc.directory/${encodeURIComponent(did)}`;
  const [host, ...path] = did.slice(8).split(":").map(decodeURIComponent);
  return `https://${host}/${path.length ? `${path.map(encodeURIComponent).join("/")}/did.json` : ".well-known/did.json"}`;
}

export async function resolvePds(
  did: string,
  json: JsonReader,
  signal: AbortSignal,
): Promise<URL> {
  const identity = identitySchema.parse(await json(identityUrl(did), signal));
  if (identity.id !== did) throw new Error("DID document mismatch");
  const service = identity.service.find(
    (s) => s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`,
  );
  return new URL(pdsUrlSchema.parse(service?.serviceEndpoint));
}
