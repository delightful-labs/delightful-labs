import { describe, expect, it } from "vitest";
import { xml2js } from "xml-js";
import {
  legacyPosts,
  legacyLocation,
} from "../src/lib/server/publication/legacy";
import { publicationFeed } from "../src/lib/server/publication/feeds";
import { publicationSitemap } from "../src/lib/server/publication/sitemap";
import { snapshot } from "./fixtures/snapshots";

const origin = "https://delightfullabs.com";

describe("legacy URL routing", () => {
  it.each(legacyPosts)(
    "maps $slug directly to the record route with its query intact",
    (post) => {
      const source = new URL(post.legacyUrl + "?source=old");
      expect(legacyLocation(source, origin)?.href).toBe(
        origin + post.path + "?source=old",
      );
      source.pathname = source.pathname.slice(0, -1);
      expect(legacyLocation(source, origin)?.href).toBe(
        origin + post.path + "?source=old",
      );
    },
  );
  it.each(["/", "/blog/", "/blog", "/tags/", "/tags"])(
    "maps the old index %s",
    (path) => {
      expect(
        legacyLocation(
          new URL("https://thoughts.delightfullabs.com" + path),
          origin,
        )?.href,
      ).toBe(origin + "/open-thoughts/");
    },
  );
  it("routes the feed and sitemap to matching resources", () => {
    expect(
      legacyLocation(
        new URL("https://thoughts.delightfullabs.com/feed/feed.xml"),
        origin,
      )?.pathname,
    ).toBe("/open-thoughts/atom.xml");
    expect(
      legacyLocation(
        new URL("https://thoughts.delightfullabs.com/sitemap.xml"),
        origin,
      )?.pathname,
    ).toBe("/sitemap.xml");
  });
  it.each([
    "https://delightfullabs.com/blog/thinking-as-you-go/",
    "https://example.vercel.app/blog/thinking-as-you-go/",
    "https://thoughts.delightfullabs.com/not-found/",
    "https://thoughts.delightfullabs.com/blog/a-tools-for-thought-ecosystem/m-R-Dmd_ly-1280.png",
  ])("leaves %s alone", (url) => {
    expect(legacyLocation(new URL(url), origin)).toBeUndefined();
  });
});

describe("native publication feeds", () => {
  function publication() {
    const value = snapshot(123);
    const article = value.articles[0];
    article.uri = legacyPosts[0].uri;
    article.key = legacyPosts[0].key!;
    article.path = legacyPosts[0].path;
    article.title = "A <title> & text";
    article.document.content = {
      $type: "pub.leaflet.content",
      pages: [
        {
          $type: "pub.leaflet.pages.linearDocument",
          id: "root",
          blocks: [
            {
              block: {
                $type: "pub.leaflet.blocks.header",
                level: 2,
                plaintext: "Section",
              },
            },
            {
              block: {
                $type: "pub.leaflet.blocks.text",
                plaintext: "Original <body> & text",
              },
            },
          ],
        },
      ],
    };
    return value;
  }
  it("keeps legacy item IDs while correcting links and rendering complete unstyled content", () => {
    const value = publication();
    const feed = JSON.parse(publicationFeed(value, origin, "feed.json"));
    expect(feed.title).toBe(value.publication.name);
    expect(feed.items[0]).toMatchObject({
      id: legacyPosts[0].atomId,
      url: origin + value.articles[0].path,
      title: "A <title> & text",
    });
    expect(feed.items[0].content_html).toContain("<h2");
    expect(feed.items[0].content_html).toMatch(
      /Original &lt;body(?:>|&gt;) &amp; text/,
    );
    expect(feed.items[0].content_html).not.toContain("style=");
    expect(feed.items[0].content_html).not.toContain("font-");
  });
  it("uses the full AT URI for a new article instead of matching a legacy record key alone", () => {
    const value = publication();
    value.articles[0].uri = `at://did:plc:other/site.standard.document/${legacyPosts[0].key}`;
    const feed = JSON.parse(publicationFeed(value, origin, "feed.json"));
    expect(feed.items[0].id).toBe(value.articles[0].uri);
  });
  it.each(["atom.xml", "rss.xml"] as const)(
    "produces valid %s XML with escaped metadata and native links",
    (format) => {
      const text = publicationFeed(publication(), origin, format);
      const parsed = xml2js(text, {
        compact: true,
      }) as import("xml-js").ElementCompact;
      expect(parsed).toBeTruthy();
      const title =
        format === "atom.xml"
          ? parsed.feed.entry.title
          : parsed.rss.channel.item.title;
      expect(title._cdata ?? title._text).toBe(
        format === "atom.xml"
          ? "A &lt;title&gt; &amp; text"
          : "A <title> & text",
      );
      expect(text).toContain(legacyPosts[0].atomId);
      expect(text).toContain(origin + legacyPosts[0].path);
      expect(text).not.toContain("https://example.com/</link>");
    },
  );
  it("does not change item IDs or dates when storage verification time changes", () => {
    const first = publication();
    const second = { ...first, verifiedAt: 99_999_999, stale: true };
    expect(publicationFeed(first, origin, "atom.xml")).toBe(
      publicationFeed(second, origin, "atom.xml"),
    );
  });
  it("allows a legitimately empty publication without fabricating entries", () => {
    const empty = { ...publication(), articles: [] };
    expect(
      JSON.parse(publicationFeed(empty, origin, "feed.json")).items,
    ).toEqual([]);
  });
});

describe("native sitemap", () => {
  it("lists the site and current AT-backed article URLs only", () => {
    const value = snapshot(1);
    const xml = publicationSitemap(value, origin);
    const parsed = xml2js(xml, { compact: true }) as {
      urlset: { url: { loc: { _text: string } }[] };
    };
    expect(parsed.urlset.url.map((row) => row.loc._text)).toEqual([
      origin + "/",
      origin + "/open-thoughts/",
      origin + value.articles[0].path,
    ]);
    expect(xml).not.toContain("example.com");
  });
  it("has only the shell routes when no publication is configured", () => {
    const xml = publicationSitemap(null, origin);
    expect((xml.match(/<url>/g) || []).length).toBe(2);
  });
});
