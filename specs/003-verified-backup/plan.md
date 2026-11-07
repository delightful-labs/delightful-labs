# Implementation Plan: Verified workspace backup and restore

**Branch**: `feat/verified-backup` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Status (2026-11-07)**: T004 is closed with accepted performance limitations; further investigation
is deferred until a production occurrence. Finance's delivered capture/restore/UI and fake-data
rehearsal are complete. T014 is implemented and locally qualified, completing the shared
implementation scope. Publication, Finance's package update and the existing uncommitted Finance
capacity change still need their separate review/publication.

**Implementation baseline (2026-11-05)**: Shared archive, envelope, independent inspection, capture/export,
versioned journal and complete test app restore are implemented and qualified. PR #26 adds fresh
full-content comparison, activation, complete coordination and native event-routing cleanup.
PR #26 is merged. All 1,097 functional cases, static/package/consumer checks and GitHub CI pass on `d69fe4c`.
See [the active handoff](tasks.md#current-handoff), [restore evidence](restore-completion-design.md),
[routing audit](native-event-routing-review.md) and [performance baseline](test-app-performance.md).

T006/T012 are complete for the test app reference. T007's read-only deployed Finance inventory is
complete. Finance capture and isolated restore (T008/T009) are merged. The user-directed T010
deployed fake-data rehearsal passed; see the task ledger. Explicit permission-repair retry (T014)
is implemented and locally qualified. T004's limitation is accepted. No production-data access or
identity/storage change is implied.

**Finance adoption merged (2026-11-07):** [Finance PR #54](https://github.com/delightful-labs/delightful-finances/pull/54)
and [Finance PR #57](https://github.com/delightful-labs/delightful-finances/pull/57) implement
T008 capture/profile/UI and T009 isolated restore, comparison, recovery and UI on Jazz alpha.59,
using DLF `ad99117`. The final PR CI run
[42376826034](https://github.com/delightful-labs/delightful-finances/actions/runs/42376826034)
passed, including the three-browser restore recovery job. Finance's
[implementation and evidence](https://github.com/delightful-labs/delightful-finances/blob/ab6c85073b0fbb2187283965a547eb50928f166c/specs/015-workspace-backup/spec.md)
records the disposable-data qualification. T004 is closed with accepted limitations; T014
confirmed-rejection retry is locally qualified and awaits package adoption. T010 passed on a deployed preview with fake data and a
separate Jazz app; production data and credentials are excluded.

## Summary

The implemented foundation separates the bounded archive/independent inspector from stateful
export/restore coordination. The test app reference demonstrates the complete flow. Finance’s domain profile and UI are now implemented against its existing
`jazz-tools@2.0.0-alpha.59` deployment. A newer Jazz release and AT Protocol sign-in are not prerequisites.

The 2026-11-05 [native experiment](../../fixtures/native-capture/README.md) supersedes Finance's
proposed writer gate and repeated graph comparison. Hydrate the complete supported scope through
ordinary remote reads, capture and validate through one exclusive transaction, then commit with
zero application mutations and await the native verdict before protection/download. Discard any
rejected capture; an explicit retry starts fresh. Owner authority, complete coverage and exact byte
handling remain consumer responsibilities. See the [replacement contract](contracts/native-capture.md).

Restore requires an additive Finance isolation design before destination writes: durable operation identity, stable destination IDs, incomplete status, ordinary workflow exclusion, and authoritative reconciliation. Finance PR #57 implements and qualifies its schema, policy and consumer interaction on disposable
data; platform performance and actual deployed recovery still require their own evidence.

## Technical Context

- **Language**: strict TypeScript 6.0.3; no casts, `any`, or `switch`.
- **Dependencies**: Zod 4.1.11 for internal strict schemas/type inference, native Web Crypto, UTF-8 encoding and file APIs for pure archive handling; XState 5.33.2 for lifecycle. Svelte 5/DUI/Paraglide only at later presentation boundaries. Existing Jazz alpha.59 stays in Finance integration.
- **Storage**: portable bounded JSON envelope; consumer-owned domain database; durable consumer-owned restore journal. Do not persist decrypted records or passwords in machine snapshots.
- **Platform**: secure-context desktop browsers first. Browser compatibility and memory behavior must be qualified before platform claims. Independent reader uses standard cryptographic primitives without a Jazz session.
- **Verification**: static checks during implementation review; unit, package-consumer, browser, real Jazz permissions and restart checks after the user approves the corresponding implementation, per repository policy.
- **Scale**: initial conservative bounds: 64 MiB outer file, 32 MiB decoded payload, 16 MiB aggregate raw attachments, 8 MiB per attachment, 50,000 records, 32 nesting levels. These are implemented bounds, not evidence the deployed workspace fits or every permitted maximum is performance-qualified. Refuse oversized captures before success; measure deployed requirements before adoption.
- **Performance**: input bounds prevent unbounded work; no streaming or compression in v1. Desktop 1/4/8 MiB measurements are complete; 8 MiB recorded a 684 ms timer delay. The [633-record investigation](record-performance.md) adds T007-sized synthetic data and exposes journal/per-record costs. Qualify the actual Finance profile/interaction and domain restore after T008/T009; address bounded off-thread work and repeated journal/plan processing before responsiveness claims. Do not describe current APIs as cancellable cryptographic operations.
- **Scope**: one workspace, explicit application profile, current supported application graph. No scheduled backup service, whole engine history, generic ORM, second backend, or migration automation.

## Constitution Check

Pre-design and post-design checks pass for the proposed boundaries:

- Jazz remains the sole application backend. Archive primitives do not create a second backend or schema abstraction.
- DLF contains no financial schemas or permission rules. Finance owns complete capture, financial validation, and destination behavior. DUI owns generic presentation; apps own routes.
- Pure archive transforms may be functions. Stateful operations use explicitly owned XState children; see [workflow contract](contracts/workflow.md).
- Unknown writes retain durable operation identity and require authoritative reconciliation. Local acceptance and remote confirmation remain distinct.
- No private/offline/platform guarantees exceed recorded evidence. File inspection can be independent; source completeness and destination recovery require qualification.
- The user explicitly authorized test app completion, tests and experiments together, followed by
  the routing cleanup. Future work follows repository review gates unless separately overridden.
- Publication of PR #26 is authorized; its merge is the user’s action. No Finance deployment, live
  data migration or identity/storage configuration change is authorized by this documentation.

Finance isolation and capture are implemented in merged PRs #54/#57. Consumer capacity/platform
measurements and deployed fake-data retained-file recovery are recorded. The user accepts the
remaining scaling/failure limitation for this delivery; no universal platform guarantee is claimed.

## Project Structure

Documentation: this plan, [research](research.md), [data model](data-model.md), [archive contract](contracts/archive-v1.md), [workflow contract](contracts/workflow.md), [Finance adoption](contracts/finance-adoption.md), and [validation guide](quickstart.md).

Implemented layout:

```text
src/lib/backup/                  # Portable codecs, opaque resources, contracts, journal schemas
src/lib/machines/backup/         # Capture/export, inspection, crypto and journaled write owners
fixtures/backup-reader/          # Independent retained-file reader without Jazz/login
fixtures/test-app/        # Consumer profile, source, full Jazz restore and qualification
fixtures/package-consumer/       # Public-subpath type/runtime/browser checks
```

Public subpaths: `backup/archive`; `backup/envelope`, `backup/inspection`, `backup/export` and
`backup/restore` with their `/workflow` entries; `backup/restore/journal` with `/browser` and
`/workflow`. Pure archive imports remain independent of XState, Svelte and Jazz. These are distinct
from the existing identity-restoration exports; no proposed `backup/contracts` entry is published.

Finance additions live in a separate Finance feature branch/PR: a consumer profile, domain capture/restore actors, durable restore schema/policies, and one consumer-owned interaction per review cycle. Existing workspace creation is not reused unchanged. Source names and exact schema changes are finalized in that consumer design review.

## Remaining delivery sequence

**T007 is complete:** the [deployed inventory](finance-deployment-inventory.md) verifies frontend
`31f70cb`, the matching 22-table backend schema/policy head v8, owner authority, 633 projected records
and zero reachable attachment bytes. Its 672,633-byte comparison encoding, matching local/remote
projections and zero observed tracked pending writes identify the current workload, not a validated
archive or capture protocol. Repeat inventory if source/deployment/device changes before adoption.

1. **T004, closed with accepted limitations:** retain the measured workload/platform evidence and
   failures. Reopen investigation upon production occurrence, without changing current bounds or
   claiming unmeasured responsiveness. The test app baseline
   and [record workload investigation](record-performance.md) expose distinct archive and journal/
   per-record costs. T004 spans this shared baseline and actual profile/interaction/restore checks
   after T008/T009; it must not block disposable consumer implementation needed to measure those paths.
   The user subsequently authorized a broader [simplification review](restore-simplification-review.md)
   and all necessary tests. Bounded note transactions use the existing shared owner, version retained
   plans explicitly, and reject incompatible saved plans without writes. Indexed remapping and
   allocation-free byte counts
   remove avoidable repeated work. Retained JSON caches and the journal worker are removed after their
   negative measurements; historical reports remain preserved. Final synthetic results are in the
   [record report](record-performance.md#simplification-review). Actual consumer follow-up is in the
   task ledger. The closure accepts the documented SDK slowdown/failures; phone, maximum aggregate
   and storage-pressure guarantees remain unqualified.
2. **T008/T009, implemented:** merged Finance capture/profile/UI and isolated restore/policy/recovery.
   Use the actual Finance flow for T004 measurements; retain the linked CI and exact-content evidence.
3. **T010, deployed fake-data rehearsal — complete for the recorded graph:** verify that the Finance preview uses its own Jazz app,
   populate fake data under a fresh test identity, retain its downloaded file, inspect independently,
   restore into a new workspace, compare every supported value/reference/byte after a fresh session
   and preserve the fake source. No production browser, data or admin credential is required or used.

**T014** integrates the accepted explicit same-operation retry after a confirmed rejection and
repaired authority into the existing write machine. It is locally qualified with machine and native
Jazz/Chromium tests. Generic errors or unknown/hidden results never authorize replay. No automatic
retry engine is added. Publication and Finance's package adoption remain pending.

## Remaining evidence requirements

T007 preserves historical production inventory; refreshing it is outside this task. Merged Finance
evidence qualifies capture consistency, native verdicts, additive isolation and cached-client
compatibility. T010 adds deployed fake-data retained-file recovery and a complete browser restart.
T004 is closed by the user's acceptance of its documented limitations. Further SDK/performance
investigation waits for production occurrence; the failed experiments are retained. T014's shared
implementation is complete and locally qualified. Review/publication and Finance's package adoption
remain separate from the uncommitted capacity change.
Report a specific alpha.59 limitation rather than silently upgrading or deleting data. Cleared journal,
offline restart and cross-device recovery remain outside the qualified claims; expanding those claims
requires scoped evidence. No production-data access or credential use is authorized by these documents.
