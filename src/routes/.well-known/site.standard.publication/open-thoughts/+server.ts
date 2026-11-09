import { error } from "@sveltejs/kit";
import { publicationReader } from "#lib/server/leaflet/service.ts";

export const trailingSlash = "never";
export async function GET() {
  let snapshot;
  try {
    snapshot = await publicationReader().read();
  } catch {
    error(503, "Publication temporarily unavailable.");
  }
  if (!snapshot) error(404, "Publication not found.");
  return new Response(snapshot.publication.uri, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
