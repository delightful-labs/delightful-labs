import { error } from "@sveltejs/kit";
import { configuredPublicationUri } from "#lib/server/leaflet/service.ts";

export const trailingSlash = "never";
export function GET() {
  const uri = configuredPublicationUri();
  if (!uri) error(404, "Publication not found.");
  return new Response(uri, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
