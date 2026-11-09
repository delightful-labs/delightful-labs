# Tasks: Native Blog Foundation

## Setup

- [x] T001 Pin portable Svelte/Delightful UI dependencies in package.json, vendor/, and pnpm-lock.yaml.
- [x] T002 Configure SvelteKit/Vercel, TypeScript and ignored local state in vite.config.ts, tsconfig.json and .gitignore.

## Foundation

- [x] T003 Use Standard Reader types/rendering and shared safe URL/value helpers in src/lib/leaflet/.
- [x] T004 Test the public loader and unsafe/malformed content behavior in tests/reader.test.ts before implementing src/lib/server/leaflet/reader.ts.
- [x] T005 Implement bounded identity/PDS reads, cursors, filtering and cache failures in src/lib/server/leaflet/.

## US1 — basic routes

- [x] T006 [US1] Add minimal navigation and empty homepage in src/routes/+layout.svelte and src/routes/+page.svelte.
- [x] T007 [US1] Add source-backed writing index and empty/unavailable states in src/routes/open-thoughts/.

## US2 — native reading

- [x] T008 [US2] Integrate the accepted Standard Reader package and direct article route in src/lib/components/ and src/routes/open-thoughts/[rkey]/.
- [x] T009 [US2] Add canonical/document metadata and publication verification endpoint in src/routes/.
- [x] T010 [US2] Verify real public text/link/image rendering in an isolated local process and record evidence in verification.md.

## US3 — refresh foundation

- [x] T011 [US3] Verify fresh, stale, removed and unavailable outcomes with injected time/upstream responses in tests/reader.test.ts.

## US5 — reproducible build

- [x] T012 [US5] Run checks, behavior tests, production adapter build and browser validation; document config/setup in README.md and verification.md.
- [x] T013 [US5] Prepare the foundation for follow-up review with verification evidence in verification.md.

## Later stages — not foundation completion claims

- [ ] T014 [US3] Configure an owner-created Leaflet publication and prove external canonical URL persistence; record results in research.md and canonical-proof.md.
- [x] T015 [US3] Implement durable cross-instance snapshot/concurrency behavior in src/lib/server/leaflet/ and verify in Preview. Production store enablement remains gated.
- [ ] T016 [US4] Preserve archive inputs/assets, prove editable quiet import, then finalize feeds and redirects using the exact inventory in research-migration.md.
  - [x] Preserve six known-public Markdown posts, original image/license, live HTML and generated images/feed/sitemap with hashes and planned URL mappings in migration/open-thoughts/.
  - [ ] Prove one editable quiet Leaflet import with its public date and image; migrate and compare all six only after that proof.
  - [ ] Resolve record keys/aliases, fragment compatibility, replacement feeds and staged redirects before activating old-URL redirects.
  - [ ] Preserve the original export in owner-controlled storage before retiring the old repo; do not republish account fields or eight unclassified entries.
- [ ] T017 [US5] Verify hosted preview and production cutover using the approved domains; document rollback in README.md.

## Dependencies and strategy

T001–T005 precede routes. US1 can be demonstrated without a publication. US2 is
verified using an isolated public source, never a committed production default.
US3 cache checks replace named I/O actors in tests. No parallel tasks are
marked because the small foundation shares core types. T014–T017 require the
actual owner publication and deployment configuration; they do not block the
local foundation or justify copying sample content into the public site.
