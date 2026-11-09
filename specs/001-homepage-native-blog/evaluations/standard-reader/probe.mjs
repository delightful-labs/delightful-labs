import { createServer } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { buildRenderTree, segmentInline } from "@standard-reader/renderer-core";
const server = await createServer({
  root: import.meta.dirname,
  configFile: false,
  plugins: [svelte()],
  server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  ssr: { noExternal: ["@standard-reader/renderer-svelte", "svelte"] },
});
const { default: Probe } = await server.ssrLoadModule("/Probe.svelte");
const { default: SafeProbe } = await server.ssrLoadModule("/SafeProbe.svelte");
const { render } = await server.ssrLoadModule("svelte/server");
const wrap = (block) => ({ block });
const text = (plaintext) => ({ $type: "pub.leaflet.blocks.text", plaintext });
const page = (id, blocks) => ({
  $type: "pub.leaflet.pages.linearDocument",
  id,
  blocks: blocks.map(wrap),
});
const document = (blocks) => ({
  authorDid: "did:plc:testowner",
  content: { $type: "pub.leaflet.content", pages: [page("root", blocks)] },
});
const html = (doc) => render(Probe, { props: { document: doc } }).body;
const facet = (byteStart, byteEnd, type, extra = {}) => ({
  index: { byteStart, byteEnd },
  features: [{ $type: `pub.leaflet.richtext.facet#${type}`, ...extra }],
});
const results = {};
try {
  const basic = html(
    document([
      text("<script>alert(1)</script>"),
      { $type: "pub.leaflet.blocks.header", level: 2, plaintext: "Heading" },
      { $type: "pub.leaflet.blocks.code", plaintext: "<b>code</b>" },
    ]),
  );
  results.ssr = {
    rendersParagraph: basic.includes("<p>"),
    rendersHeading: basic.includes("<h2>"),
    escapesText: !basic.includes("<script>"),
    escapedCode: basic.includes("&lt;b") && !basic.includes("<b>code</b>"),
    headingAnchor: /<h2[^>]*\sid=/.test(basic),
  };
  const membership = html(
    document([
      text("PUBLIC_BEFORE"),
      { $type: "pub.leaflet.blocks.membersOnlyDelimiter" },
      text("AFTER_BOUNDARY"),
    ]),
  );
  results.membersOnly = {
    beforeRendered: membership.includes("PUBLIC_BEFORE"),
    afterRendered: membership.includes("AFTER_BOUNDARY"),
  };
  const overlap = {
    plaintext: "abcdef",
    facets: [facet(0, 4, "bold"), facet(2, 6, "italic")],
  };
  results.overlappingFacets = segmentInline(overlap);
  results.invalidUtf8Facet = segmentInline({
    plaintext: "A😀B",
    facets: [facet(2, 4, "bold")],
  });
  results.validUtf8Facet = segmentInline({
    plaintext: "A😀B",
    facets: [facet(1, 5, "bold")],
  });
  const unsafe = html(
    document([
      {
        ...text("click"),
        facets: [facet(0, 5, "link", { uri: "javascript:alert(1)" })],
      },
    ]),
  );
  results.unsafeLink = {
    containsJavascriptHref: unsafe.includes('href="javascript:alert(1)"'),
  };
  results.iframe = {
    emitted: html(
      document([
        { $type: "pub.leaflet.blocks.iframe", url: "https://example.com" },
      ]),
    ).includes("<iframe"),
  };
  results.unknown = {
    fallbackVisible: html(
      document([{ $type: "pub.leaflet.blocks.futureBlock" }]),
    ).includes("futureBlock"),
  };
  const pages = {
    authorDid: "did:plc:testowner",
    content: {
      $type: "pub.leaflet.content",
      pages: [
        page("root", [
          text("ROOT"),
          { $type: "pub.leaflet.blocks.page", id: "child" },
        ]),
        page("child", [text("CHILD")]),
        page("orphan", [text("ORPHAN")]),
      ],
    },
  };
  const pagesHtml = html(pages);
  results.pages = {
    childRendered: pagesHtml.includes("CHILD"),
    orphanRendered: pagesHtml.includes("ORPHAN"),
    childAnchor: pagesHtml.includes('id="page-child"'),
  };
  const image = {
    $type: "pub.leaflet.blocks.image",
    image: { ref: { $link: "baaaaaaaaaa" }, mimeType: "image/png", size: 100 },
    alt: "Alt text",
  };
  results.image = buildRenderTree(document([image])).children;
  results.customImageResolver = buildRenderTree(document([image]), {
    resolveImageUrl: () => "https://pds.example/image",
  }).children;
  const safeHtml = render(SafeProbe, {
    props: {
      document: document([
        {
          ...text("click"),
          facets: [facet(0, 5, "link", { uri: "javascript:alert(1)" })],
        },
        { $type: "pub.leaflet.blocks.iframe", url: "https://example.com" },
        { $type: "pub.leaflet.blocks.futureBlock" },
      ]),
    },
  }).body;
  results.snippetOverrides = {
    stripsUnsafeLink: !safeHtml.includes("javascript:"),
    noIframe: !safeHtml.includes("<iframe"),
    fallbackCount: (safeHtml.match(/View this content on Leaflet/g) ?? [])
      .length,
  };
  results.blobPages = buildRenderTree({
    content: {
      $type: "pub.leaflet.content",
      blobPages: {
        ref: { $link: "baaaaaaaaaa" },
        mimeType: "application/json",
        size: 100,
      },
    },
  });
  results.checklist = {
    nativeCheckbox: html(
      document([
        {
          $type: "pub.leaflet.blocks.unorderedList",
          children: [{ checked: true, content: text("TASK") }],
        },
      ]),
    ).includes('type="checkbox"'),
  };
  console.log(JSON.stringify(results, null, 2));
} finally {
  await server.close();
}
