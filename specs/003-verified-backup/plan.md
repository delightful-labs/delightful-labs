# Implementation Plan: Verified workspace backup and restore

**Branch**: `feat/verified-backup` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Status (2026-11-05)**: Shared archive, envelope, independent inspection, capture/export,
versioned journal and complete notebook restore are implemented and qualified. PR #26 adds fresh
full-content comparison, activation, complete coordination and native event-routing cleanup.
All 1,097 functional cases, static/package/consumer checks and GitHub CI pass on `d69fe4c`.
See [the active handoff](tasks.md#current-handoff), [restore evidence](restore-completion-design.md),
[routing audit](native-event-routing-review.md) and [performance baseline](notebook-performance.md).

T006/T012 are complete for the notebook reference. Remaining gates are T004 consumer/platform
performance, Finance inventory/capture/isolated restore/rehearsal (T007–T010), and the accepted explicit
permission-repair retry integration (T014). No Finance deployment or identity/storage change is implied.

## Summary

The implemented foundation separates the bounded archive/independent inspector from stateful
export/restore coordination. The notebook reference demonstrates the complete flow. The next adoption
is Finance’s domain profile against its existing `jazz-tools@2.0.0-alpha.59` deployment. A newer Jazz release and AT Protocol sign-in are not prerequisites.

Finance capture uses an explicitly quiescent single-user maintenance procedure, remote reads for supported complete graph coverage, and comparison with local-first results to detect unsynchronized differences. This is a scoped operational capture, not a claim of SDK snapshot isolation. Do not accept a capture when writer quiescence, full owner authority, or required graph coverage cannot be established. Details and limits appear in [Finance adoption](contracts/finance-adoption.md).

Restore requires an additive Finance isolation design before destination writes: durable operation identity, stable destination IDs, incomplete status, ordinary workflow exclusion, and authoritative reconciliation. The notebook supplies a qualified reference for these capabilities; Finance-specific schema, policy,
consumer interaction and deployment compatibility remain unimplemented and require their own evidence.

## Technical Context

- **Language**: strict TypeScript 6.0.3; no casts, `any`, or `switch`.
- **Dependencies**: Zod 4.1.11 for internal strict schemas/type inference, native Web Crypto, UTF-8 encoding and file APIs for pure archive handling; XState 5.33.2 for lifecycle. Svelte 5/DUI/Paraglide only at later presentation boundaries. Existing Jazz alpha.59 stays in Finance integration.
- **Storage**: portable bounded JSON envelope; consumer-owned domain database; durable consumer-owned restore journal. Do not persist decrypted records or passwords in machine snapshots.
- **Platform**: secure-context desktop browsers first. Browser compatibility and memory behavior must be qualified before platform claims. Independent reader uses standard cryptographic primitives without a Jazz session.
- **Verification**: static checks during implementation review; unit, package-consumer, browser, real Jazz permissions and restart checks after the user approves the corresponding implementation, per repository policy.
- **Scale**: initial conservative bounds: 64 MiB outer file, 32 MiB decoded payload, 16 MiB aggregate raw attachments, 8 MiB per attachment, 50,000 records, 32 nesting levels. These are implemented bounds, not evidence the deployed workspace fits or every permitted maximum is performance-qualified. Refuse oversized captures before success; measure deployed requirements before adoption.
- **Performance**: input bounds prevent unbounded work; no streaming or compression in v1. Desktop 1/4/8 MiB measurements are complete; 8 MiB recorded a 684 ms timer delay. Qualify actual consumer sizes/platforms under T004 and decide whether CPU/file parsing needs a dedicated worker before responsiveness claims; do not describe current APIs as cancellable cryptographic operations.
- **Scope**: one workspace, explicit application profile, current supported application graph. No scheduled backup service, whole engine history, generic ORM, second backend, or migration automation.

## Constitution Check

Pre-design and post-design checks pass for the proposed boundaries:

- Jazz remains the sole application backend. Archive primitives do not create a second backend or schema abstraction.
- DLF contains no financial schemas or permission rules. Finance owns complete capture, financial validation, and destination behavior. DUI owns generic presentation; apps own routes.
- Pure archive transforms may be functions. Stateful operations use explicitly owned XState children; see [workflow contract](contracts/workflow.md).
- Unknown writes retain durable operation identity and require authoritative reconciliation. Local acceptance and remote confirmation remain distinct.
- No private/offline/platform guarantees exceed recorded evidence. File inspection can be independent; source completeness and destination recovery require qualification.
- The user explicitly authorized notebook completion, tests and experiments together, followed by
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
fixtures/backup-notebook/        # Consumer profile, source, full Jazz restore and qualification
fixtures/package-consumer/       # Public-subpath type/runtime/browser checks
```

Public subpaths: `backup/archive`; `backup/envelope`, `backup/inspection`, `backup/export` and
`backup/restore` with their `/workflow` entries; `backup/restore/journal` with `/browser` and
`/workflow`. Pure archive imports remain independent of XState, Svelte and Jazz. These are distinct
from the existing identity-restoration exports; no proposed `backup/contracts` entry is published.

Finance additions live in a separate Finance feature branch/PR: a consumer profile, domain capture/restore actors, durable restore schema/policies, and one consumer-owned interaction per review cycle. Existing workspace creation is not reused unchanged. Source names and exact schema changes are finalized in that consumer design review.

## Remaining delivery sequence

1. **T007, read-only inventory:** verify published Finance revisions, schema/permissions, all released
   graph/attachment coverage, pending local writes and actual sizes.
2. **T004, consumer performance:** measure that supported workload/platform and address unacceptable
   blocking or memory use before claiming responsiveness or increasing bounds. The notebook baseline
   is already recorded; a worker is a decision based on qualification, not an assumed redesign.
3. **T008, Finance capture/profile/interaction:** allowlisted complete graph, owner authority,
   maintenance/drain, exact bytes, local/remote comparison and disposable-data qualification.
4. **T009, Finance isolated restore:** additive schema/policy lane, stable mappings/journal,
   reconciliation, domain staging, fresh comparison and activation. Qualify policies, cached clients,
   restart and uncertain outcomes before proposing live additive deployment.
5. **T010, actual recovery rehearsal:** retain the deployed file, inspect independently, restore into
   a new isolated destination, compare every supported value/reference/byte in a fresh session and
   preserve the original. This precedes separate identity/storage work.

**T014** separately integrates the already accepted explicit same-operation retry after a confirmed
rejection and repaired authority. The journal representation is ready; the writer currently stops
conservatively. Generic errors or unknown/hidden results never authorize replay. No automatic retry
engine is planned.

## Remaining evidence requirements

Actual production revisions/catalogue/permission hashes, released graph and size inventory, Finance
capture consistency and local/remote differences, additive isolation with cached-client compatibility,
and an actual retained-file recovery remain required. Notebook success does not establish consumer
completeness or production safety. Report a specific alpha.59 limitation rather than silently upgrading
or deleting data. Browser-process crash, cleared journal, offline restart and cross-device recovery
remain outside the qualified notebook claims; expanding those claims requires scoped evidence.
