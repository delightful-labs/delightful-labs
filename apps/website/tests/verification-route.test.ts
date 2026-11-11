import { describe, expect, it, vi } from "vitest";
import { GET } from "../src/routes/.well-known/site.standard.publication/open-thoughts/+server";
const { publicationUri } = vi.hoisted(() => ({
  publicationUri: vi.fn<() => string | undefined>(),
}));
// No reader or network dependency is provided: verification must use configuration.
vi.mock("../src/lib/server/leaflet/service", () => ({
  configuredPublicationUri: publicationUri,
}));

describe("publication verification", () => {
  it("serves the configured URI independently of archive availability", async () => {
    const uri = "at://did:plc:testowner/site.standard.publication/test";
    publicationUri.mockReturnValue(uri);
    const response = GET();
    expect(await response.text()).toBe(uri);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns 404 when no publication is configured", () => {
    publicationUri.mockReturnValue(undefined);
    expect(GET).toThrow(expect.objectContaining({ status: 404 }));
  });
});
