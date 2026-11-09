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
