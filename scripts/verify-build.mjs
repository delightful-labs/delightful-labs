import assert from "node:assert/strict";
import { Server } from "../.svelte-kit/output/server/index.js";
import { manifest } from "../.svelte-kit/output/server/manifest.js";

// Exercise emitted SSR modules through Node's resolver, without Vite's dev loader.
const server = new Server(manifest);
await server.init({ env: { LEAFLET_PUBLICATION_URI: "" } });
for (const [path, status] of [
  ["/", 200],
  ["/open-thoughts/", 200],
  ["/open-thoughts/unknown/", 404],
  ["/migration/open-thoughts/manifest.json", 404],
  ["/migration/open-thoughts/source/content/blog/thinking-as-you-go.md", 404],
]) {
  const response = await server.respond(
    new Request(`https://example.com${path}`),
    {
      getClientAddress: () => "127.0.0.1",
    },
  );
  assert.equal(response.status, status, `Built SSR route ${path}`);
  console.log(`${status} ${path}`);
}

for (const path of ["atom.xml", "rss.xml", "feed.json"]) {
  const response = await server.respond(
    new Request(`https://example.com/open-thoughts/${path}`),
    { getClientAddress: () => "127.0.0.1" },
  );
  assert.equal(response.status, 404, `Unconfigured feed ${path}`);
}
const sitemap = await server.respond(
  new Request("https://example.com/sitemap.xml"),
  { getClientAddress: () => "127.0.0.1" },
);
assert.equal(sitemap.status, 200);
assert.match(await sitemap.text(), /<urlset/);
const { default: posts } = await import(
  "../src/lib/server/publication/legacy.json",
  { with: { type: "json" } }
);
for (const post of posts) {
  const row = {
    from: `https://thoughts.delightfullabs.com/blog/${post.slug}/`,
    to: `https://delightfullabs.com/open-thoughts/${post.key}/`,
  };
  const response = await server.respond(
    new Request(row.from + "?from=archive"),
    { getClientAddress: () => "127.0.0.1" },
  );
  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), row.to + "?from=archive");
}
for (const [alias, target] of [
  ["atom", "atom.xml"],
  ["rss", "rss.xml"],
  ["json", "feed.json"],
]) {
  const response = await server.respond(
    new Request(`https://example.com/open-thoughts/${alias}/?follow=1`),
    { getClientAddress: () => "127.0.0.1" },
  );
  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    `https://example.com/open-thoughts/${target}?follow=1`,
  );
}
console.log(
  "Built feed matching, sitemap, six direct legacy redirects and feed aliases verified",
);
