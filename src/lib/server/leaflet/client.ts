import type { JsonReader } from "./model";
import { commitSchema } from "./schemas";

export type Rpc = (
  method: string,
  params: Record<string, string>,
) => Promise<unknown>;

export function createRpc(
  endpoint: URL,
  json: JsonReader,
  signal: AbortSignal,
): Rpc {
  return (method, params) => {
    signal.throwIfAborted();
    const url = new URL(`/xrpc/${method}`, endpoint);
    for (const [name, value] of Object.entries(params))
      url.searchParams.set(name, value);
    return json(url.href, signal);
  };
}

export async function readCommit(rpc: Rpc, did: string): Promise<string> {
  return commitSchema.parse(
    await rpc("com.atproto.sync.getLatestCommit", { did }),
  ).cid;
}
