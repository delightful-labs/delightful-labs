import type { Handle } from "@sveltejs/kit/hooks";
import { legacyLocation } from "#lib/server/publication/legacy.ts";
import { canonicalOrigin } from "#lib/server/leaflet/service.ts";

export const handle: Handle = ({ event, resolve }) => {
  const destination = legacyLocation(event.url, canonicalOrigin());
  if (destination) return Response.redirect(destination, 308);
  const feeds: Record<string, string> = {
    atom: "atom.xml",
    rss: "rss.xml",
    json: "feed.json",
  };
  const alias = /^\/open-thoughts\/(atom|rss|json)\/?$/.exec(
    event.url.pathname,
  );
  if (alias)
    return Response.redirect(
      new URL(
        `/open-thoughts/${feeds[alias[1]]}${event.url.search}`,
        event.url,
      ),
      308,
    );
  return resolve(event);
};
