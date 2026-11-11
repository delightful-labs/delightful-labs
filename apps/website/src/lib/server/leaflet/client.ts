export function rpcUrl(
  endpoint: string,
  method: string,
  params: Record<string, string>,
): string {
  const url = new URL(`/xrpc/${method}`, endpoint);
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value);
  return url.href;
}
