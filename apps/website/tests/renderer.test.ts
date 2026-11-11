import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import LeafletDocument from "../src/lib/components/LeafletDocument.svelte";

const block = (type: string, fields = {}) => ({
  block: { $type: `pub.leaflet.blocks.${type}`, ...fields },
});
function article(blocks: unknown[]) {
  return render(LeafletDocument, {
    props: {
      document: {
        authorDid: "did:plc:testowner",
        content: {
          $type: "pub.leaflet.content",
          pages: [
            { $type: "pub.leaflet.pages.linearDocument", id: "root", blocks },
          ],
        },
      },
      pds: "https://pds.example",
      sourceUrl: "https://example.leaflet.pub/post",
    },
  }).body;
}

describe("Standard Reader integration", () => {
  it("renders native server HTML using the package and existing DUI components", () => {
    const html = article([
      block("text", { plaintext: "Native body <script>alert(1)</script>" }),
      block("header", { level: 2, plaintext: "Section" }),
      block("image", {
        image: {
          ref: { $link: "baaaaaaaaaa" },
          mimeType: "image/png",
          size: 100,
        },
        alt: "Supplied alt",
      }),
    ]);
    expect(html).toContain("Native body");
    expect(html).toContain("<h2");
    expect(html).not.toContain("<script>");
    expect(html).toContain(
      "https://pds.example/xrpc/com.atproto.sync.getBlob?",
    );
    expect(html).toContain('alt="Supplied alt"');
    expect(html).not.toContain("cdn.bsky.app");
  });

  it("keeps frames out and rejects unsafe inline, website, and button links", () => {
    const html = article([
      block("iframe", { url: "https://example.com" }),
      block("text", {
        plaintext: "click",
        facets: [
          {
            index: { byteStart: 0, byteEnd: 5 },
            features: [
              {
                $type: "pub.leaflet.richtext.facet#link",
                uri: "javascript:alert(1)",
              },
            ],
          },
        ],
      }),
      block("website", { src: "javascript:alert(1)", title: "Unsafe site" }),
      block("button", { url: "javascript:alert(1)", text: "Unsafe button" }),
    ]);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.leaflet.pub/post"');
    expect(html).toContain("click");
  });
});
