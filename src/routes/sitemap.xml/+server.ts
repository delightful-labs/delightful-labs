import { canonicalOrigin } from "#lib/server/leaflet/service.ts";
import { readPublication } from "#lib/server/publication/read.ts";
import { publicationSitemap } from "#lib/server/publication/sitemap.ts";

export const trailingSlash = "never";
export async function GET() {
  return new Response(
    publicationSitemap(await readPublication(), canonicalOrigin()),
    {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}
