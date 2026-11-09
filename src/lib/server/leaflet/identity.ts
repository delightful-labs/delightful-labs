export function identityUrl(did: string): string {
  if (did.startsWith("did:plc:"))
    return `https://plc.directory/${encodeURIComponent(did)}`;
  const [host, ...path] = did.slice(8).split(":").map(decodeURIComponent);
  return `https://${host}/${path.length ? `${path.map(encodeURIComponent).join("/")}/did.json` : ".well-known/did.json"}`;
}
