import posts from "./legacy.json";

// Only compatibility identifiers live here; Leaflet owns all article content.
const owner = "did:plc:226m7t4kp7d7sg2qsdresypm";
export const legacyPosts = posts.map(({ slug, key }) => ({
  slug,
  key,
  uri: `at://${owner}/site.standard.document/${key}`,
  legacyUrl: `https://thoughts.delightfullabs.com/blog/${slug}/`,
  path: `/open-thoughts/${key}/`,
  atomId: `https://example.com/blog/${slug}/`,
}));
export const legacyPost = (uri: string) =>
  legacyPosts.find((post) => post.uri === uri);

const legacyPaths = new Map([
  ...legacyPosts.map((post) => [`/blog/${post.slug}/`, post.path] as const),
  ...["/", "/blog/", "/tags/"].map(
    (path) => [path, "/open-thoughts/"] as const,
  ),
  ["/feed/feed.xml", "/open-thoughts/atom.xml"],
  ["/sitemap.xml", "/sitemap.xml"],
]);

export function legacyLocation(url: URL, origin: string): URL | undefined {
  if (url.hostname !== "thoughts.delightfullabs.com") return;
  const path = url.pathname;
  const destination = legacyPaths.get(path) ?? legacyPaths.get(path + "/");
  if (!destination) return;
  const target = new URL(destination, origin);
  target.search = url.search;
  return target;
}
