# Standard Reader renderer evaluation

Evaluated 2026-11-09 against the published npm tarballs for
`@standard-reader/renderer-svelte@0.4.0` and `renderer-core@0.4.0`, with the
project's Svelte 5.57.3 / Vite 8.3.7 versions on Node 25.2.1.

**Owner decision: adopt version 0.4.0 with its current constraints.** The owner
accepted the findings after this evaluation: there is no existing Leaflet
publication yet, and no package fixes or compatibility layer are requested.
The application now uses the package; only URL, no-iframe, PDS image, and DUI
integration overrides remain.

**Initial evaluation recommendation (superseded by owner decision):** It is a
useful upstream candidate, but adopting it now would retain substantial custom
preprocessing and add a dependency whose inline segmentation loses content
fidelity. Reevaluate after upstream facet fixes and explicit handling of our
boundary and preservation requirements. The isolated evaluation itself did not change application dependencies; the
subsequent owner-authorized adoption does.

Sources: [maintainer documentation](https://standard-reader.app/docs/renderers),
[Svelte package](https://www.npmjs.com/package/@standard-reader/renderer-svelte),
[core package](https://www.npmjs.com/package/@standard-reader/renderer-core).
Implementation observations below come from executing these exact packages and
inspecting their distributed source, rather than documentation claims alone.

## Results

| Requirement | Observed result | Integration work |
| --- | --- | --- |
| Native Svelte SSR | Pass: paragraph, heading, and code emitted in server HTML; script-like text escaped | Compatible foundation |
| No typography additions | Published Svelte components contain no styles | Compatible; map snippets to existing DUI components |
| Valid UTF-8 facets | Pass for an emoji facet on correct byte boundaries | Keep existing regression tests |
| Overlapping facets | Fail: bold bytes 0–4 and italic 2–6 turn `abcdef` into `abcdcdef` | Core parser fix; snippets receive already-corrupted segments |
| Invalid UTF-8 facet boundaries | Fail: splits inside emoji produce replacement characters | Validate facets before parsing or fix core parser |
| Member-only delimiter | Fail: text after delimiter is still rendered | Prune before rendering, including referenced pages; a delimiter snippet cannot stop later siblings |
| Safe URLs | Default SSR emits `href="javascript:alert(1)"` | Override all link-bearing node types and validate URLs; no click was executed |
| No frames | Defaults emit iframe nodes | Verified shared iframe snippet replaces them with a link fallback |
| Unknown content | Defaults silently omit unknown blocks | Verified unknown snippet provides visible fallback |
| Linked subpages | Referenced child renders inline; orphan root page also renders; expected `page-child` anchor absent | Preserve current reachability policy and anchors with preprocessing/overrides |
| Heading anchors | No default heading ID | Add deterministic IDs; snippet receives level/children, not our existing normalized ID |
| Blob-backed pages | Blob-only content returns no render tree | Retain PDS blob retrieval and hydrate `content.pages` before rendering |
| Images | Defaults resolve through Bluesky CDN; alt preserved in tree | Verified image resolver option accepts custom PDS URL; retain URL/blob validation and broken-image fallback |
| Leaflet checklist items | `checked: true` in unordered-list child emits no checkbox | Core conversion discards this field for Leaflet list items; override alone cannot recover it |

The source also traverses pages recursively without the application's existing
page/block/depth limits. The application must retain bounded input validation.
This evaluation did not stress-test pathological recursion, execute malicious
URLs, test browser hydration, or load a live article. It proves server execution
and specific compatibility differences, not complete support for all formats.

## Reproduce

Copy this directory outside the application checkout, then run:

```sh
npm install --ignore-scripts --no-audit --no-fund --no-package-lock
npm run probe
```

The probe starts Vite in middleware mode with WebSockets disabled; it exposes no
HTTP server. It compiles the published Svelte components for SSR and prints
observations. `results.json` records the observed output. `Probe.svelte` uses
package defaults; `SafeProbe.svelte` demonstrates safe inline-link, iframe, and
unknown-block overrides, without styles. Those three overrides are a feasibility
proof, not a complete safe integration. Test content is synthetic and never
included in application routes.

Tarball SHA-1 values reported by npm (artifact identity, not a security claim):

- Svelte: `57d56e0425d5f176b3252529f44729665e03fd34`
- Core: `f30ced043b67b3c35e8d88e7d9604681e4f3b878`
