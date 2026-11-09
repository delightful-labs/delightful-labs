import { error } from "@sveltejs/kit";
import { canonicalOrigin } from "#lib/server/leaflet/service.ts";
import { readPublication } from "#lib/server/publication/read.ts";
import {
  feedFormats,
  publicationFeed,
  type FeedFormat,
} from "#lib/server/publication/feeds.ts";
import type { RequestHandler } from "./$types";

export const trailingSlash = "never";
export const GET: RequestHandler = async ({ params }) => {
  const snapshot = await readPublication();
  if (!snapshot) error(404, "Publication is not configured.");
  const format = params.feed as FeedFormat;
  return new Response(publicationFeed(snapshot, canonicalOrigin(), format), {
    headers: {
      "content-type": feedFormats[format],
      "cache-control": "no-store",
    },
  });
};
