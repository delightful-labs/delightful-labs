import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";

export function publicAddress(ip: string): boolean {
  return ipaddr.isValid(ip) && ipaddr.parse(ip).range() === "unicast";
}

// Validate the very addresses used by the socket, without a second DNS lookup.
export const lookupPublicAddress: LookupFunction = (
  hostname,
  options,
  callback,
) => {
  lookup(hostname, { all: true }).then(
    (addresses) => {
      if (
        !addresses.length ||
        addresses.some(({ address }) => !publicAddress(address))
      ) {
        callback(new Error("Non-public upstream"), "", 0);
        return;
      }
      const candidates = options.family
        ? addresses.filter((entry) => entry.family === options.family)
        : addresses;
      if (!candidates.length) {
        callback(new Error("No upstream address for requested family"), "", 0);
        return;
      }
      if (options.all) callback(null, candidates);
      else callback(null, candidates[0].address, candidates[0].family);
    },
    (error) => callback(error, "", 0),
  );
};
const dispatcher = new Agent({
  connect: { lookup: lookupPublicAddress, timeout: 5_000 },
});
if (import.meta.hot) import.meta.hot.dispose(() => dispatcher.destroy());

export async function readJson(
  input: string,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Invalid upstream URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && !publicAddress(host))
    throw new Error("Non-public upstream");
  const response = await fetch(url, {
    dispatcher,
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(12_000),
      ...(signal ? [signal] : []),
    ]),
    headers: { accept: "application/json" },
  });
  try {
    if (!response.ok || !response.body)
      throw new Error(`Upstream response ${response.status}`);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 6_000_000) throw new Error("Upstream size limit");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    if (!response.body?.locked) await response.body?.cancel();
  }
}
