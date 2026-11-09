import { js2xml } from "xml-js";
import type { Snapshot } from "../leaflet/model";

export function publicationSitemap(
  snapshot: Snapshot | null,
  origin: string,
): string {
  return js2xml(
    {
      _declaration: { _attributes: { version: "1.0", encoding: "UTF-8" } },
      urlset: {
        _attributes: { xmlns: "http://www.sitemaps.org/schemas/sitemap/0.9" },
        url: [
          { loc: { _text: `${origin}/` } },
          { loc: { _text: `${origin}/open-thoughts/` } },
          ...(snapshot?.articles.map((article) => ({
            loc: { _text: origin + article.path },
            lastmod: { _text: article.updatedAt ?? article.publishedAt },
          })) ?? []),
        ],
      },
    },
    { compact: true },
  );
}
