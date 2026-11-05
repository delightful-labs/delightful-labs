# Verified backup implementation tasks

Implementation began after PR #15. The user subsequently authorized the combined notebook
completion, tests and experiments in PR #26, then the repository-wide routing cleanup. That
combined authorization does not authorize Finance deployment or identity/storage changes.

## Current handoff

**Updated 2026-11-05.** PRs #23–#26 are merged. [PR #26](https://github.com/delightful-labs/delightful-local-first/pull/26)
implements complete notebook restore and native actor routing.
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

The user authorized a broader implementation review and all necessary tests while away. The
[simplification review](restore-simplification-review.md) replaces the unsuccessful serialized-cache
and worker experiments with allocation-free UTF-8 byte counts, indexed graph remapping and bounded
note transactions under the existing restore owner. At the user's request, all entry points now
use only the faster plan (fixed saved version 2); older plans are rejected without writes. The historical
[reuse](journal-reuse-design.md) and [worker](journal-worker-design.md) measurements remain preserved;
the worker path and retained JSON caches are removed. Final measurements and qualification are
recorded in the review and [performance report](record-performance.md#simplification-review).
Changes are ready for pull-request review; no deployment has been performed.

**T007 is complete:** [read-only deployed Finance inventory](finance-deployment-inventory.md)
verifies frontend `31f70cb`, the 22-table backend schema and permission head v8, owner authority,
633 scoped projected records and zero reachable attachments. Local/remote projections match and
no tracked pending writes were observed in the existing browser. The comparison encoding totals
672,633 bytes; it is not a Finance archive-size or capture-readiness claim.

## Next work

1. Use the [T007 inventory](finance-deployment-inventory.md) for **T004** consumer/platform
   qualification. The [simplification review](restore-simplification-review.md) resolves the
   synthetic notebook's multi-minute record restore through bounded consumer transactions.
   T004 stays open: qualify actual Finance capture/interaction after T008 and domain restore after
   T009, plus supported platforms and memory limits. Synthetic count/size matching is not Finance
   recovery evidence. The 1/4/8 MiB binary workload remains a separate responsiveness concern.
2. **T008:** implement and qualify Finance capture/profile and consumer interaction on disposable
   data. It supplies the actual encoded graph/file and interaction for T004 export/open qualification.
3. **T009:** implement and qualify additive isolated restore/policies and domain transaction batches
   on disposable data. Qualify T004 restore performance against this actual path before live claims.
4. **T010:** retain and independently inspect an actual deployed backup, restore/compare it in a
   fresh isolated destination/session and preserve the original before identity/storage changes.

**T014** is a separate explicit retry integration follow-up. It is not an automatic retry engine
or a prerequisite to recognizing the already qualified conservative notebook path.

## Completed shared, notebook and inventory work

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
- [x] **T007:** establish deployed Finance frontend/backend revisions, schema/permission hashes,
      all released record/attachment types, observable pending local writes and aggregate sizes
      read-only. [Inventory evidence](finance-deployment-inventory.md): deployed frontend `31f70cb`,
      matching 22-table schema/policies at head v8, 633 projected records, zero reachable attachment
      bytes, matching local/remote projections and zero tracked pending operations. Scope excludes
      hidden physical rows, excluded secret/avatar values and other devices. No source mutation,
      publication, write flush or storage reset was performed; capture qualification remains T008.
- [x] **State-model cleanup:** envelope/avatar/recovery/custody corrections and the routing audit of
      all 45 machine-bearing modules. Nineteen implementation modules now use state-scoped native
      sends; qualified seed-health and stale-assessment checks remain deliberately documented.

## Remaining qualification and adoption

- [ ] **T004:** qualify memory, latency and responsiveness on actual consumer sizes and supported
      platforms. The [record report](record-performance.md) preserves the 323–439-second baseline,
      ten-minute 4× CPU timeout and unsuccessful reuse/worker experiments. The subsequent
      [simplification review](restore-simplification-review.md) uses bounded note transactions,
      indexed projection and allocation-free byte counting; its final results supersede the old
      performance bottleneck for this synthetic workload. Archive limits remain unchanged. Actual
      Finance profile/interaction measurements depend on T008, and staged domain restore on T009.
      Consumer implementation can proceed on disposable data while T004 stays a readiness gate;
      desktop/throttled notebook results do not qualify phones or actual Finance recovery.
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
