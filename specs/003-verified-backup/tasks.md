# Verified backup implementation tasks

Implementation began after PR #15. The user subsequently authorized the combined notebook
completion, tests and experiments in PR #26, then the repository-wide routing cleanup. That
combined authorization does not authorize Finance deployment or identity/storage changes.

## Current handoff

**Updated 2026-11-05.** PRs #23–#25 are merged. [PR #26](https://github.com/delightful-labs/delightful-local-first/pull/26)
implements complete notebook restore and native actor routing and is ready for the user's merge.
The notebook root coordinates the retained plan, all mapped writes, fresh exact-content comparison,
activation and same-browser resume. Shared actors own journal/lock/transaction settlement and drain.
No Finance data, production configuration or dependency versions changed.

Final implementation qualification: **1,097 functional cases** — 927 units, 17 independent-reader,
18 notebook-export, 60 native Jazz/Chromium restore, 65 Storybook browser and 10 native private-creation
cases — plus strict static/package/consumer checks. GitHub CI passed on `d69fe4c`. Three separate
1/4/8 MiB desktop experiments establish a bounded baseline, not mobile or deployed-Finance support.
See [restore evidence](restore-completion-design.md), [routing audit](native-event-routing-review.md)
and [performance report](notebook-performance.md). Earlier slice notes live in
[handoff history](handoff-history.md).

## Next work

1. **T007:** inventory the actual deployed Finance revisions, released graph and sizes read-only.
2. Use that inventory for **T004** consumer/platform performance qualification; decide whether
   responsiveness requires a bounded worker/off-thread implementation before consumer claims.
3. **T008–T009:** implement and qualify Finance capture/profile, consumer interaction and additive
   isolated restore/policies on disposable data before proposing live changes.
4. **T010:** retain and independently inspect an actual deployed backup, restore/compare it in a
   fresh isolated destination/session and preserve the original before identity/storage changes.

**T014** is a separate explicit retry integration follow-up. It is not an automatic retry engine
or a prerequisite to recognizing the already qualified conservative notebook path.

## Completed shared and notebook work

- [x] **T001:** bounded portable archive codec, strict schemas, canonical values and graph validation.
- [x] **T002:** archive corruption, bounds, exactness and public-package qualification.
- [x] **T003:** plaintext integrity and password envelope, native crypto, immutable releasable resources.
- [x] **T005:** independent retained-file inspector; generic integrity/profile outcomes remain distinct.
- [x] **T006:** shared capture/export and complete notebook restore: isolated destination, retained
      mappings, all attachments/notebook/notes, fresh exact fields/references/bytes/set comparison,
      activation, reload/resume and uncertain-activation reconciliation without duplicate replay.
- [x] **T012:** concrete versioned Zod restore journal, bounded attempts/receipts, CAS and durable
      progress through comparison/activation. Finance-specific integration remains T009.
- [x] **T011:** optional Zod form-error adapter, preserving library-neutral consumer contracts.
- [x] **T013:** profile draft-check review; retain simple draft checks rather than adding a schema.
- [x] **State-model cleanup:** envelope/avatar/recovery/custody corrections and the routing audit of
      all 45 machine-bearing modules. Nineteen implementation modules now use state-scoped native
      sends; qualified seed-health and stale-assessment checks remain deliberately documented.

## Remaining qualification and adoption

- [ ] **T004:** qualify memory, latency and responsiveness on actual consumer sizes and supported
      platforms. Functional crypto/interop and the 1/4/8 MiB desktop runs are complete. The 8 MiB run
      recorded a 684 ms timer delay and substantial memory use. Inventory comes from T007; do not
      expand limits or claim phone responsiveness from the desktop result.
- [ ] **T007:** establish deployed Finance frontend/backend revisions, schema/permission hashes,
      all released record/attachment types, pending local writes and aggregate sizes read-only. No
      schema/data mutation, production auto-publication or live storage reset during inventory.
- [ ] **T008:** implement Finance's allowlisted capture/profile and consumer-owned backup interaction
      against its existing Jazz alpha.59 setup, including owner authority, quiescent/drained capture,
      exact complete attachment bytes, local/remote comparison and disposable-data qualification.
- [ ] **T009:** implement Finance's additive incomplete-destination lane, policies, journal/mappings,
      inert provenance, domain writes, comparison and activation. Qualify real policies, cached clients,
      restart and uncertain outcomes on disposable data before proposing deployment.
- [ ] **T010:** demonstrate retained-file independent validation, isolated full restore, fresh-session
      exact comparison and original preservation from the actual deployed workspace before changing
      deployed identity or storage. Never treat a download or notebook fixture as that evidence.
- [ ] **T014:** integrate an explicit same-operation retry after a confirmed remote rejection and
      corrected authority, as accepted in [the spec](spec.md#accepted-retry-behavior--2026-11-03).
      The journal already represents a new attempt and bounded prior rejection. The current write
      owner deliberately retains rejection/uncertainty without issuing another transaction; permission
      repair alone does not resume it. Reuse the same destination/mappings, recheck authority, retain
      rejected evidence and qualify the actual writer. Generic exceptions, hidden/null reads and unknown
      outcomes must never authorize replay. No automatic retries or repair heuristics are required.

## Qualification boundary

The notebook source is an in-memory actor; destination/policy checks use actual Jazz. Recovery is
qualified for the same browser/origin with retained IndexedDB and a reselected matching archive,
including page reload/fresh session. Browser-process crash, cleared journal, offline restart and
cross-device/browser recovery are not qualified product claims. Additional platform guarantees need
an explicit scoped requirement and evidence; they are not implied TODOs for this PR.

The overall Finance-first backup feature remains incomplete. Sign-in implementation and its Zod
configuration/external-input TODOs remain in
[the separate delivery plan](../002-shared-delightful-sign-in/delivery.md#zod-validation-todos).
Historical implementation evidence remains linked in [the handoff archive](handoff-history.md).
