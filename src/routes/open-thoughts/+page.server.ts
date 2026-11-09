import { error } from "@sveltejs/kit";
import { publicationReader } from "#lib/server/leaflet/service.ts";

export async function load() {
  try {
    const snapshot = await publicationReader().read();
    return {
      articles:
        snapshot?.articles.map(({ pages, ...article }) => article) ?? [],
    };
  } catch {
    error(503, "Writing is temporarily unavailable. Please try again.");
  }
}
