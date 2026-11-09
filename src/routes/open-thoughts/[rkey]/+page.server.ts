import { error } from "@sveltejs/kit";
import {
  canonicalOrigin,
  publicationReader,
} from "#lib/server/leaflet/service.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params }) => {
  let snapshot;
  try {
    snapshot = await publicationReader().read();
  } catch {
    error(503, "Writing is temporarily unavailable. Please try again.");
  }
  const article = snapshot?.articles.find(
    (article) => article.key === params.rkey,
  );
  if (!article) error(404, "Post not found.");
  return { article, canonical: `${canonicalOrigin()}${article.path}` };
};
