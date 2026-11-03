# Implementation Plan: Verified workspace backup and restore

**Branch**: `feat/verified-backup` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Status**: Implementation started after merged PR #15. The first structural payload slice has passed local verification and is in PR #16; no live export or verified restore exists yet. See [tasks](tasks.md) and [implementation review notes](implementation-notes.md).

## Summary

Start implementation with a standalone, bounded DLF archive codec and independent file inspector. It has no Jazz, Finance, login, or UI dependency. Add the stateful export/restore coordination separately, then Finance’s domain profile against its existing `jazz-tools@2.0.0-alpha.59` deployment. A newer Jazz release and AT Protocol sign-in are not prerequisites.

Finance capture uses an explicitly quiescent single-user maintenance procedure, remote reads for supported complete graph coverage, and comparison with local-first results to detect unsynchronized differences. This is a scoped operational capture, not a claim of SDK snapshot isolation. Do not accept a capture when writer quiescence, full owner authority, or required graph coverage cannot be established. Details and limits appear in [Finance adoption](contracts/finance-adoption.md).

Restore requires an additive Finance isolation design before destination writes: durable operation identity, stable destination IDs, incomplete status, ordinary workflow exclusion, and authoritative reconciliation. These capabilities are absent today. The archive and inspector are independently implementable while the Finance-specific qualification work proceeds.

## Technical Context

- **Language**: strict TypeScript 6.0.3; no casts, `any`, or `switch`.
- **Dependencies**: Zod 4.1.11 for internal strict schemas/type inference, native Web Crypto, UTF-8 encoding and file APIs for pure archive handling; XState 5.33.2 for lifecycle. Svelte 5/DUI/Paraglide only at later presentation boundaries. Existing Jazz alpha.59 stays in Finance integration.
- **Storage**: portable bounded JSON envelope; consumer-owned domain database; durable consumer-owned restore journal. Do not persist decrypted records or passwords in machine snapshots.
- **Platform**: secure-context desktop browsers first. Browser compatibility and memory behavior must be qualified before platform claims. Independent reader uses standard cryptographic primitives without a Jazz session.
- **Verification**: static checks during implementation review; unit, package-consumer, browser, real Jazz permissions and restart checks after the user approves the corresponding implementation, per repository policy.
- **Scale**: initial conservative bounds: 64 MiB outer file, 32 MiB decoded payload, 16 MiB aggregate raw attachments, 8 MiB per attachment, 50,000 records, 32 nesting levels. These are proposed limits, not evidence the real workspace fits. Refuse oversized captures before success; measure deployed requirements before adoption.
- **Performance**: input bounds prevent unbounded work; no streaming or compression in v1. Measure peak memory and KDF responsiveness on supported browsers. Move CPU/file parsing to a dedicated worker if qualification shows unacceptable main-thread blocking; do not describe current APIs as cancellable cryptographic operations.
- **Scope**: one workspace, explicit application profile, current supported application graph. No scheduled backup service, whole engine history, generic ORM, second backend, or migration automation.

## Constitution Check

Pre-design and post-design checks pass for the proposed boundaries:

- Jazz remains the sole application backend. Archive primitives do not create a second backend or schema abstraction.
- DLF contains no financial schemas or permission rules. Finance owns complete capture, financial validation, and destination behavior. DUI owns generic presentation; apps own routes.
- Pure archive transforms may be functions. Stateful operations use explicitly owned XState children; see [workflow contract](contracts/workflow.md).
- Unknown writes retain durable operation identity and require authoritative reconciliation. Local acceptance and remote confirmation remain distinct.
- No private/offline/platform guarantees exceed recorded evidence. File inspection can be independent; source completeness and destination recovery require qualification.
- Implementation review precedes implementation tests. The payload-codec slice is synchronous; the user authorized proceeding with review/tests and the implementation notes record passing verification. Subsequent code follows focused review cycles.
- The user subsequently authorized beginning backup archive implementation after merging PR #15. No deployment, data migration, commit, or publication is implied by that instruction.

Finance’s missing isolation and capture qualification are concrete required implementation work, not exceptions to these principles. Dependent consumer operations must not pretend those capabilities exist.

## Project Structure

Documentation: this plan, [research](research.md), [data model](data-model.md), [archive contract](contracts/archive-v1.md), [workflow contract](contracts/workflow.md), [Finance adoption](contracts/finance-adoption.md), and [validation guide](quickstart.md).

Proposed DLF source additions:

```text
src/lib/backup/                  # Pure bounded archive codec, crypto, validation
src/lib/contracts/backup.ts      # Profile, reports, safe opaque-resource contracts
src/lib/machines/backup/         # Export, file inspection, restore coordination
src/lib/integrations/backup/     # Browser file/resource ownership, later UI binding
fixtures/backup-reader/         # Independent reader without Jazz/login dependencies
fixtures/package-consumer/      # Public backup subpath checks
```

Proposed public subpaths: `./backup/archive`, `./backup/contracts`, `./backup/workflow`. Keep pure archive imports independent of XState, Svelte, and Jazz. Do not conflate this with the existing identity-restoration exports.

Finance additions live in a separate Finance feature branch/PR: a consumer profile, domain capture/restore actors, durable restore schema/policies, and one consumer-owned interaction per review cycle. Existing workspace creation is not reused unchanged. Source names and exact schema changes are finalized in that consumer design review.

## Delivery sequence

1. **Archive core**: implement bounded encoding/decoding, exact value validation, plaintext digest, authenticated password encryption/decryption, and immutable validated-archive resources. Present focused implementation for review; then add/run meaningful crypto/format/limit tests.
2. **Independent inspector**: read an actual retained file, validate its generic structure, report domain profile compatibility separately, and release secrets/resources. Review then verify without Jazz or original login.
3. **Shared lifecycle**: implement export and restore workflow contracts with a small nonfinancial profile and explicit ownership/cancellation. Review then test failures, stale reports, and uncertain writes.
4. **Finance capture**: first read-only deployment/schema inventory; then implement all allowlisted released graph coverage, owner authority, maintenance/drain handling, file assembly, local/remote comparison, and domain archive validation. Export does not change the source schema. Review and qualify before using real data.
5. **Finance restore**: independently design/review additive durable operation/isolation fields and backend rules on a disposable app. Implement stable mapping, journal, exact reconciliation, phased graph staging, content comparison, and activation. Qualify restart, rejection, permissions, and old-client behavior before a live additive deployment is proposed.
6. **Actual recovery rehearsal**: retain the real exported file; validate and restore into a new isolated destination; verify every declared record value/reference and attachment byte; confirm original unchanged. Record evidence without private contents. Only then proceed to the separate identity/storage work.

Each numbered item is a review boundary, not permission to batch the entire implementation. The user authorized implementation after merging the design. [Tasks](tasks.md) split archive item 1 into structural codec and cryptographic/resource review slices; no whole-feature completion is implied.

## Remaining evidence requirements

These do not prevent starting archive implementation: current production revision and catalogue/permission hashes; real data size/type inventory; Jazz remote/local read and unknown-write qualification; exact Finance restore isolation policy with cached-client compatibility. They prevent claiming consumer completeness or successful recovery until actually resolved. If alpha.59 cannot satisfy an operation, report the specific limitation and adjust that operation openly rather than requiring an unexamined upgrade or deleting data.
