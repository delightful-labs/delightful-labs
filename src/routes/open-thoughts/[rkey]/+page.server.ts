import { error, redirect } from "@sveltejs/kit";
import { canonicalOrigin } from "#lib/server/leaflet/service.ts";
import { readPublication } from "#lib/server/publication/read.ts";
import { archivePosts, archivedPost } from "#lib/server/publication/archive.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url }) => {
  const snapshot = await readPublication();
  const alias = archivePosts.find((post) => post.slug === params.rkey);
  const article = snapshot?.articles.find(
    (article) => article.key === params.rkey || article.uri === alias?.uri,
  );
  if (!article) error(404, "Post not found.");
  if (article.key !== params.rkey) redirect(308, article.path + url.search);
  return {
    article,
    canonical: `${canonicalOrigin()}${article.path}`,
    legacyTitleId: archivedPost(article.uri)?.slug,
  };
};
