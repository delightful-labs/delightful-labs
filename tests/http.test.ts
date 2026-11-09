import type { LookupAddress } from "node:dns";
import { Response, fetch } from "undici";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  lookupPublicAddress,
  publicAddress,
  readJson,
} from "../src/lib/server/leaflet/http";

const { dnsLookup } = vi.hoisted(() => ({
  dnsLookup: vi.fn<() => Promise<LookupAddress[]>>(),
}));
vi.mock("node:dns/promises", () => ({ lookup: dnsLookup }));
vi.mock("undici", async (original) => ({
  ...(await original<typeof import("undici")>()),
  fetch: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());
const resolve = () =>
  new Promise((accept, reject) => {
    lookupPublicAddress(
      "pds.example",
      { family: 0, hints: 0, all: true },
      (error, addresses) => (error ? reject(error) : accept(addresses)),
    );
  });

describe("public upstream transport", () => {
  it("hands the validated DNS answer directly to the socket callback", async () => {
    const addresses = [
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ];
    dnsLookup.mockResolvedValue(addresses);
    expect(await resolve()).toEqual(addresses);
    expect(dnsLookup).toHaveBeenCalledTimes(1);
  });

  it.each([
    { addresses: [] },
    { addresses: [{ address: "127.0.0.1", family: 4 }] },
    {
      addresses: [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    },
  ])(
    "rejects empty or non-public DNS answers $addresses",
    async ({ addresses }) => {
      dnsLookup.mockResolvedValue(addresses);
      await expect(resolve()).rejects.toThrow("Non-public upstream");
    },
  );

  it("honors a requested socket address family", async () => {
    dnsLookup.mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    const resolved = await new Promise((accept, reject) => {
      lookupPublicAddress(
        "pds.example",
        { family: 6, hints: 0 },
        (error, address, family) =>
          error ? reject(error) : accept({ address, family }),
      );
    });
    expect(resolved).toEqual({ address: "2606:4700:4700::1111", family: 6 });
  });

  it("propagates DNS errors", async () => {
    dnsLookup.mockRejectedValue(new Error("DNS unavailable"));
    await expect(resolve()).rejects.toThrow("DNS unavailable");
  });

  it.each([
    "2001:db8::1",
    "2001:2::1",
    "2001::1",
    "2002:7f00:1::",
    "::ffff:127.0.0.1",
    "100.64.0.1",
    "198.18.0.1",
  ])("rejects special-purpose address %s", (address) => {
    expect(publicAddress(address)).toBe(false);
  });

  it.each([
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com:444",
    "https://127.0.0.1",
    "https://[::1]",
  ])("rejects disallowed URL before transport: %s", async (url) => {
    await expect(readJson(url)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads JSON with a controlled dispatcher and no redirect following", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"ok":true}'));
    expect(await readJson("https://pds.example")).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://pds.example"),
      expect.objectContaining({
        dispatcher: expect.anything(),
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("cancels non-success bodies", async () => {
    const response = new Response("error", { status: 503 });
    const cancel = vi.spyOn(response.body!, "cancel");
    vi.mocked(fetch).mockResolvedValue(response);
    await expect(readJson("https://pds.example")).rejects.toThrow("503");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects oversized bodies", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(" ".repeat(6_000_001)));
    await expect(readJson("https://pds.example")).rejects.toThrow("size limit");
  });
});
