# Implementation Plan: Verified workspace backup and restore

**Branch**: `feat/verified-backup` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Status (2026-11-05)**: Shared archive, envelope, independent inspection, capture/export,
versioned journal and complete test app restore are implemented and qualified. PR #26 adds fresh
full-content comparison, activation, complete coordination and native event-routing cleanup.
PR #26 is merged. All 1,097 functional cases, static/package/consumer checks and GitHub CI pass on `d69fe4c`.
See [the active handoff](tasks.md#current-handoff), [restore evidence](restore-completion-design.md),
[routing audit](native-event-routing-review.md) and [performance baseline](test-app-performance.md).

T006/T012 are complete for the test app reference. T007's read-only deployed Finance inventory is
complete. Remaining gates are T004 consumer/platform performance, Finance capture/isolated
restore/rehearsal (T008–T010), and the accepted explicit
permission-repair retry integration (T014). No Finance deployment or identity/storage change is implied.

## Summary

The implemented foundation separates the bounded archive/independent inspector from stateful
export/restore coordination. The test app reference demonstrates the complete flow. The next adoption
is Finance’s domain profile against its existing `jazz-tools@2.0.0-alpha.59` deployment. A newer Jazz release and AT Protocol sign-in are not prerequisites.

Finance capture uses an explicitly quiescent single-user maintenance procedure, remote reads for supported complete graph coverage, and comparison with local-first results to detect unsynchronized differences. This is a scoped operational capture, not a claim of SDK snapshot isolation. Do not accept a capture when writer quiescence, full owner authority, or required graph coverage cannot be established. Details and limits appear in [Finance adoption](contracts/finance-adoption.md).

Restore requires an additive Finance isolation design before destination writes: durable operation identity, stable destination IDs, incomplete status, ordinary workflow exclusion, and authoritative reconciliation. The test app supplies a qualified reference for these capabilities; Finance-specific schema, policy,
consumer interaction and deployment compatibility remain unimplemented and require their own evidence.

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

Finance’s missing isolation and capture qualification are concrete required implementation work, not exceptions to these principles. Dependent consumer operations must not pretend those capabilities exist.

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

1. **T004, consumer performance:** measure that supported workload/platform and address unacceptable
   blocking or memory use before claiming responsiveness or increasing bounds. The test app baseline
   and [record workload investigation](record-performance.md) expose distinct archive and journal/
   per-record costs. T004 spans this shared baseline and actual profile/interaction/restore checks
   after T008/T009; it must not block disposable consumer implementation needed to measure those paths.
   The user subsequently authorized a broader [simplification review](restore-simplification-review.md)
   and all necessary tests. Bounded note transactions use the existing shared owner, version retained
   plans explicitly, and reject incompatible saved plans without writes. Indexed remapping and
   allocation-free byte counts
   remove avoidable repeated work. Retained JSON caches and the journal worker are removed after their
   negative measurements; historical reports remain preserved. Final synthetic results are in the
   [record report](record-performance.md#simplification-review). T004 remains open for actual consumer
   and platform qualification; these changes do not authorize deployment or Finance integration.
2. **T008, Finance capture/profile/interaction:** allowlisted complete graph, owner authority,
   maintenance/drain, exact bytes, local/remote comparison and disposable-data qualification.
3. **T009, Finance isolated restore:** additive schema/policy lane, stable mappings/journal,
   reconciliation, domain staging, fresh comparison and activation. Qualify policies, cached clients,
   restart and uncertain outcomes before proposing live additive deployment.
4. **T010, actual recovery rehearsal:** retain the deployed file, inspect independently, restore into
   a new isolated destination, compare every supported value/reference/byte in a fresh session and
   preserve the original. This precedes separate identity/storage work.

**T014** separately integrates the already accepted explicit same-operation retry after a confirmed
rejection and repaired authority. The journal representation is ready; the writer currently stops
conservatively. Generic errors or unknown/hidden results never authorize replay. No automatic retry
engine is planned.

## Remaining evidence requirements

T007 records actual production frontend/catalogue/policy identity and scoped live graph/size
measurements. Finance capture consistency and full profile/envelope size, explicit writer drain,
additive isolation with cached-client compatibility and an actual retained-file recovery remain
required. Test app success does not establish consumer
completeness or production safety. Report a specific alpha.59 limitation rather than silently upgrading
or deleting data. Browser-process crash, cleared journal, offline restart and cross-device recovery
remain outside the qualified test app claims; expanding those claims requires scoped evidence.
