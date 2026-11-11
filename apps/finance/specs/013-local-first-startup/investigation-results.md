# Consolidated investigation and verification

This report supersedes earlier provisional status notes. The user authorized exploring all open
items and running the checks together without further review pauses. The spec is **not complete**:
several required behaviors remain unbuilt or unsupported. No production optimization, dependency
upgrade, permission workaround, commit or deployment was made during this verification batch.

## Verification

- Seven focused unit suites: **205 passed** (application/workspace readiness, startup,
  initialization, optional seeding, transaction saving and permissions).
- Chromium production PWA/startup suites: **18 passed**, including genuine cold offline restarts,
  public-cache boundaries, detail URLs, update consent/drafts, silent negotiation, an already
  negotiated connection stalled before a local save, later acceptance, and real server rejection.
- Existing offline access/reconnection scenarios: **10 passed**, covering owners/admins,
  all/selected-account members, read/write grants, viewers, missing grants and unrelated users.
- Firefox/WebKit production offline/update matrix: **10 distinct cases verified** (nine initially,
  the Firefox detail case on a targeted rerun after correcting its protocol body-inspection issue).
- Additional Firefox/WebKit cold-runtime probes: **2 passed**. Firefox HTTP disk/memory caches were
  disabled. WebKit retained HTTP cache, so its result proves saved-record persistence and browser
  process restart, not the complete unmasked asset chain. Chromium's existing cold suite clears
  HTTP cache with CDP. See `cross-browser-cold.json`.

The Firefox driver could not read one cached navigation response body due to invalid content
encoding. That case now checks the mapped public shell through Cache Storage in Firefox and retains
response-body inspection elsewhere. Navigation status, service-worker origin, saved field values
and reload remain asserted. This does not claim the Firefox wire body was inspected successfully.

Application checking passed with zero errors/warnings; test TypeScript, targeted formatting and
whitespace checks passed. Forty distinct browser workflow checks and 205 unit tests were verified.
Detailed outcomes are recorded at the end of research.md.
Passing workflows do not turn the failing preparation investigation below into a passing guarantee.

## Decisions by open item

| Item                              | Result and disposition                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T009 local usability verification | Verified the implemented slice, including negotiated nonresponse, later acceptance/rejection and the existing role matrix. Unknown-outcome recovery remains T012.                                                                                                                                                                                                                                                         |
| T010 new/restored identity        | Alpha.59 still has no public durable provenance result for automatic root selection. Retain safe discovery. Automatic first-workspace bootstrap offline remains unbuilt. An explicit app-owned identity flow would require a new protocol/UX; no credential-storage parsing or empty-cache inference was added.                                                                                                           |
| T011 all-workspace preparation | Investigation complete on available lab tools. Remote ID subscriptions pass live/cold correctness across Chromium, Firefox and WebKit; global LocalFirst views failed live invalidation. Unbounded initial acquisition caused a roughly three-second main-thread stall. Bounded pages preserve tested cold data/live boundary behavior but are slow. Budgeted runtime owner remains unbuilt; no automatic startup sweep enabled. |
| T012 durable recovery             | In-memory checkpoint/reconciliation cases pass. Checkpoints retain a live binding and are route-owned; they cannot simply be serialized or survive route replacement. The proposed data-only write-ahead journal/application owner remains implementation work, not an SDK fix or a tested feature.                                                                                                                       |
| T014 cold/runtime/update matrix   | Saved-record cold coverage and desktop update workflows verified within the boundaries above. Real changed-graph compatibility remains the known T026 deferral; physical supported-device certification is not established.                                                                                                                                                                                               |
| T015 performance                  | Baseline, actor timing, page CPU, public-method setup and large-history probes recorded. About 0.94 s of returning page CPU samples were in Wasm execution. Public-method wrappers miss Svelte's internal subscription path, so they do not count all queries or prove duplication. No numerical budget or optimization benefit claimed.                                                                                  |
| T016 earlier initialization       | Do not adopt. Moving the current start from mount to immediately after root construction would overlap only about 2–10 ms in observed returning traces. Earlier HTML/module ownership adds lifecycle/payload work without evidence of a meaningful gain. No service-worker-owned Jazz session.                                                                                                                            |
| T017 static routing               | Do not adopt now. Chromium/WebKit expose addRoutes; Firefox does not. A direct-cache route failed offline for a query-bearing URL whose plain path was cached. Current workspace navigation intentionally normalizes queries. Queryless immutable routes remain possible, but the measured document delay is small and no app benefit demonstrated.                                                                       |
| T018 navigation preload           | Reject for current precached shells. It starts network HTML that cache hits do not need. No beneficial network-HTML navigation path was found in the app's supported offline routes.                                                                                                                                                                                                                                      |
| T019 Wasm preparation/reuse       | Compiled modules clone in memory, but IndexedDB storage throws DataCloneError in all three browsers, as required by the current WebAssembly Web API. SDK supports in-memory runtimeSources.wasmModule and versioned URL inputs, with strict worker source identity. No supported persistent compiled cache or always-running service-worker handoff; no startup/memory benefit measured for an override, so none adopted. |
| T020 application workers          | Reject moving balance calculation now: 100,000 rows took a median 3.4 ms directly versus 97.5 ms for the worker round trip with cloned inputs. No other measured app calculation justified a worker. SDK Wasm work and DOM rendering are not moved by relocating asynchronous machines.                                                                                                                                   |
| T021 install/storage              | Actual public cache: 222 responses / 42,783,124 body bytes. Two 19,342,148-byte Wasm entries are byte-identical. One Chromium origin estimate was 74,441,103 bytes, including Cache Storage and IndexedDB. Persistent storage was ungranted. Accept existing completeness fix; deduplication needs a separate exact-byte/glue compatibility design. No quota, eviction or retention guarantee.                            |
| T022 follow-through               | Added the negotiated-stall regression and fixed Firefox's test-only body inspection. Rejected/unproven optimizations remain unimplemented.                                                                                                                                                                                                                                                                                |
| T023 reconciliation               | This report, tasks and research distinguish delivered behavior, investigation evidence, deferred work and unresolved guarantees. Historical notes remain historical.                                                                                                                                                                                                                                                      |
| T026 cross-build retention        | Remains deferred by explicit user direction. No cache-retention/client-reporting implementation.                                                                                                                                                                                                                                                                                                                          |
| T027 attachment authorization | Repaired using existing Jazz relations: links inherit transaction reads; files require direct transaction read access and a matching attachment; parts inherit file reads. Full policy suite: 73 passed. Five attachment/image browser cases passed, including offline replacement/reload and viewer download. No schema change or SDK fix. |

## Measurement details and limits

The large-history diagnostic used a never-opened shared workspace with a viewer/selected membership
and one read grant. An archived permitted account remained readable; the ungranted account's
transactions were filtered. Query acquisition for 500 and 5,000 readable transactions took about
1.18 s and 6.69 s in the recorded development-server run. These include multiple remote queries and
metadata acquisition; they are not production startup comparisons. The post-acquisition one-edit
frame samples stayed around 16.7 ms; they do not measure responsiveness during initial acquisition.
See `core-preparation-probe.json`. Authorization-fact reads precede those timed acquisitions.

A cold browser reopened the original scoped URL with remote replies withheld. Even the corrected
LocalFirst queries failed to establish coverage. This is not proof that bytes were erased, nor that
every SDK query shape fails after restart. It prevents claiming that these broad snapshot reads are
a supported complete preparation protocol. The earlier unscoped navigation assumption also led to
the workspace directory and is not treated as evidence of global absence.

Cache estimates are browser reports, not exact disk/RAM consumption or compressed network transfer.
The Wasm copies have identical SHA-256
`49d0af280091fa462720a5739431cb516ab4d7cc8ca943faa0279ebcd008f056` in the inspected build. Their
separate paths currently preserve each loader's paired runtime chain; no URL replacement was made.

Desktop builds tested: Chromium 156.0.8078.4, Firefox 157.0 and WebKit 27.2. No actual phone,
production WAN, low-storage device, physical eviction, or fully distinct-build compatibility matrix
was available. No thresholds were chosen from these local samples.

## Sources and reproducibility

The installed alpha.59 source/declarations supplied SDK contracts; browser probes supplied the
runtime observations. [WebAssembly's serialization rules](https://webassembly.github.io/spec/web-api/)
reject module serialization for storage. [The Service Worker specification](https://www.w3.org/TR/service-workers/)
defines static routing. [Chrome's navigation-preload guidance](https://developer.chrome.com/docs/workbox/modules/workbox-navigation-preload)
explains why precached HTML does not need preload. Browser capability results are in
`browser-capabilities.json`; calculation samples are in `worker-benchmark.json`; cache and public
query setup data are in `runtime-cache-inventory.json` and `query-setup-profile.json`.

Run production checks in a separate checkout with its own dependencies. The permanent
`playwright.startup.config.ts` owns its build/preview and each startup test owns its in-memory backend
through the proxy. The consolidated diagnostic PWA and browser matrix reused those fixtures with
fresh per-case backends; temporary profiles, servers, source marks and fixture adapters were removed
after measurement. Cold Chromium checks retain Cache Storage/IndexedDB while clearing HTTP cache and
exiting the browser. Firefox's extra probe disabled HTTP disk/memory caches in both launches.

## Remaining feature work

1. Establish a cold query-preparation protocol before enabling all-workspace preparation. The
   attachment boundary is repaired; cold coverage remains unproven. Keep locally available work usable.
2. Resolve durable new-identity provenance before automatic offline initial bootstrap.
3. Implement the scoped durable recovery journal/owner from T012, preserving stable IDs and never
   replaying unknown writes automatically.
4. Obtain supported physical-device/network/storage measurements before setting budgets or adopting
   further optimizations. Keep the explicitly deferred cross-build cache work separate.


Post-T027 cold-data follow-up is recorded separately in cold-query-follow-up.json and research.md.
Small closed/silent/disconnect controls, the 10,000-row silent case and metadata/on-demand content
case all produced their expected data. These are isolated dev-runtime data probes, not additional
production shell or user-flow guarantees. Cold reads use the retained identity after every reader
client exits. Their positive results qualify the earlier failure; they do not identify its cause or
establish all-workspace completeness. The next cost comparison is now recorded in preparation-cost-follow-up.json: retained full-row
queries add 21 MiB page heap at 5,000 readable transactions, versus 10.3 MiB for public ID projection.
One-shot snapshots remained stale in the observed remote-edit window; retained queries receive the
edit. Cold ID-projection checks retain tested full transaction fields/audit, remote inserts and
file/link metadata while preserving on-demand file content. Prefer retained ID queries for the next
implementation review. Worker memory, storage, other relationships and progress semantics remain
open; no preparation owner is implemented.


The final T011 evidence and superseding transport correction are in
[remaining-investigation-results.json](remaining-investigation-results.json) and the final research
section. The page-level WebSocket mock was not a reliable SharedWorker control; real-proxy tests now
verify the selected subscription-only design. Remote-tier acquisition is appropriate only for the
independent background owner; ordinary local-first work remains unchanged.

Do not adopt the earlier unbounded startup proposal: it produced an approximately three-second
main-thread stall. Public bounded pages retain tested cold records and react to boundary mutations,
but their latency/resource tradeoff needs a reviewed scheduling/progress implementation. Real quota
failure was not established because the reported quota override did not enforce its limit. Physical
supported-device budgets remain unverified. T010, T012 and deferred T026 remain as described above.
