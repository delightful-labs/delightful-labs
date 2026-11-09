import manifest from "../../../../migration/open-thoughts/manifest.json";

// The archive supplies URL/identity metadata only. Bodies always come from AT Protocol.
export const archivePosts = manifest.posts.map((post) => ({
  uri: post.leafletDocumentUri,
  key: post.leafletDocumentUri?.split("/").at(-1),
  slug: post.slug,
  legacyUrl: post.legacyUrl,
  path: post.nativeRecordPath,
  atomId: post.legacyAtomId,
  headingIds: post.legacyHeadingIds.slice(1),
}));
export const archivedPost = (uri: string) =>
  archivePosts.find((post) => post.uri === uri);

const legacyPaths = new Map([
  ...manifest.routePlan.articleRedirects.map(
    (row) => [new URL(row.from).pathname, new URL(row.to).pathname] as const,
  ),
  ...manifest.routePlan.indexPaths.map(
    (path) => [path, "/open-thoughts/"] as const,
  ),
  ["/feed/feed.xml", "/open-thoughts/atom.xml"],
  ["/sitemap.xml", "/sitemap.xml"],
]);

export function legacyLocation(url: URL, origin: string): URL | undefined {
  if (url.hostname !== new URL(manifest.legacyOrigin).hostname) return;
  const path = url.pathname;
  const destination = legacyPaths.get(path) ?? legacyPaths.get(path + "/");
  if (!destination) return;
  const target = new URL(destination, origin);
  target.search = url.search;
  return target;
}
