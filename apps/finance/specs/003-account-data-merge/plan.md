# Implementation Plan: Account connection with optional local-data merge

**Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)
**Feature identifier**: `003-account-data-merge`; planning performed on `main`, no branch created.

## Summary

Add a choice before recovery-phrase connection. For Merge, durably snapshot the selected eligible source workspace, switch with the supported Jazz session API, wait for the replacement workspace dependencies, preview the destination mapping and import additive records with stable identities. Preserve source records and remote edits. This is a proposed design, not implemented behavior.

## Technical context

TypeScript 6, Svelte 5/SvelteKit 3, Jazz 2.0.0-alpha.59, XState 5, Paraglide. Jazz stores finance data; a versioned browser IndexedDB journal stores the source snapshot and import mapping on this device. No new service/API is planned. Existing Vitest and Playwright tooling applies only after implementation review. Target browser/PWA; no guarantee of cross-device recovery for a device-local unfinished snapshot. Bound import batches and report progress; establish practical size limits in the first implementation cycle rather than silently truncating.

## Constitution check

Pre/post-design: local-first reads/writes and integer money preserved; organization authorization rechecked at writes; identity secrets excluded from snapshots/journals; additive schema evolution only. XState owns decisions and lifecycle; integration binds Jazz and composes props-only localized presentation. No new styling, switch clauses, casts or any. One focused implementation cycle at a time, normally 4–6 implementation files. No tests added/run before approval of their exact implementation. No commit or server started by planning.

## Architecture and statechart

Application readiness owns a merge coordinator outside the identity-bound workspace subtree, so restoring a session cannot destroy the workflow. It explicitly asks the existing workspace/bank subtree to shut down before switching and waits for replacement bindings before destination work. Page navigation/detach sends cancellation or shutdown; acknowledge child cleanup before actor stop.

```mermaid
stateDiagram-v2
    [*] --> inspectingSource
    inspectingSource --> choosing
    choosing --> cancelled: Cancel
    choosing --> switching: Connected account only
    choosing --> validatingSource: Merge
    validatingSource --> savingSnapshot
    savingSnapshot --> switching
    switching --> waitingForDestination
    waitingForDestination --> previewing: Merge
    waitingForDestination --> completed: Connected account only
    previewing --> importing: Confirm import
    previewing --> cancelled: Cancel
    importing --> verifying
    verifying --> completed
    verifying --> partial
    importing --> partial: Some writes committed, then error/cancel
    importing --> failed: No writes committed, error
```

All asynchronous states also handle error/cancel/shutdown explicitly. `switching` reconciles the actual SDK selection after an in-flight call settles; cancellation cannot undo that call. Late events cannot restart imports. Failed/cancelled/partial views offer explicit retry/resume or return-to-source when supported. Never infer phase from context flags.

Child actors: source inspection/validation; journal I/O; session switch; destination authorization/readiness; mapping/preview; dependency-ordered import, composing per-record decision/write children. Context contains observed identities, typed snapshots, mappings, counters and child results. Guards choose source availability, same identity, supported graph, destination eligibility, existing record/conflict, and final outcome. Promises perform bounded I/O, not hidden business branching.

## Import strategy

1. Hydrate source remote scope with ReadTier.Remote and reconcile pending ReadTier.LocalFirst records (or use a confirmed sync barrier first). Validate the complete graph; save snapshot before switching. Offline inability to establish scope is a retryable failure, not an empty workspace. Refuse incomplete/unsupported records with actionable explanation.
2. Hydrate destination queries and verify target identity, selected eligible organization and permissions under an approved eligibility policy. Empty local query results alone do not prove remote absence. If SDK cannot establish safe readiness, stop with retry guidance.
3. Build stable destination IDs scoped to destination organization + source organization + entity type + source ID. Use canonical existing bank IDs instead for imported provider transactions; map system categories by kind. Preview additions, known existing records, conflicts and excluded bank connections.
4. Persist mapping/provenance with each corresponding write atomically. Recheck identity, permission, reference invariants and duplicate existence in transactions. Existing target rows are skipped or classified as conflicts, never blindly updated. Deterministic identities protect retries and concurrent devices; lock/journal ownership protects concurrent tabs on this device.
5. Insert dependencies before dependents; independent Checks and their transaction references need planned IDs and valid ordering. Restore archived flags only after dependent writes. Existing protected-system-category and archived-reference permissions require deliberate sequencing, not blanket policy relaxation.
6. Wait for local persistence before reporting locally saved/pending synchronization. Use write-handle global waits for server acceptance before reporting globally confirmed completion; never use browser online status as proof. Retain an unfinished journal until resume or explicit discard. Completed snapshot cleanup removes local finance payload but retains minimal durable provenance for deduplication.

## Focused delivery/review cycles

1. Prove SDK seams and model lifecycle: inspect supported restore cancellation/readiness, source recovery and cross-tab constraints; define actor contracts and statechart. Review before effects. If SDK cannot establish safe completeness, return the concrete blocker before building an unsafe importer.
2. Add versioned snapshot validation and journal recovery, with explicit unsupported-data detection. Review, then approved coverage.
3. Add additive provenance schema/permissions and pure identity/reference mapping. Resolve archived/check/bank collision handling in this cycle. Review, then approved coverage.
4. Add the dependency-ordered import child machines and transactional adapters. Review, then approved coverage.
5. Bind coordinator to application readiness and login presentation/localization, including previews, cancellation and recovery. Discuss the exact file set first if integration requires more than six implementation files. Review, then approved coverage.
6. After relevant approvals, complete focused cross-device, offline, interruption and authorization validation. No broad unrelated test runs.

This document provides sequencing, not a generated tasks.md. Generate detailed task checklist after design review.

## Project structure

Documentation: this directory's spec.md, research.md, data-model.md, contracts/merge-ui.md and quickstart.md.
Proposed implementation: `src/lib/machines/account-merge/`, focused `src/lib/schema/` and matching `src/lib/validation/` files, `src/lib/components/LoginForm.svelte`, `src/routes/login/+page.svelte`, application-readiness integration and `messages/en.json` (confirm actual catalog location when implementing). Extend existing modules only as needed; do not expand data.ts into a generic import controller.

## Complexity tracking

No constitutional exceptions proposed. SDK capability checks and physical cross-device validation remain implementation gates; no runtime feasibility is claimed from planning alone.

## Foundation compatibility gate

Before implementation, resolve workspace eligibility without relying on personal/business kind or a unique initial workspace. Align snapshot validation and dependency mapping with the compatibility requirements in spec.md and data-model.md: independent Checks, descriptions, currency precision, and any supported allocations, attachments, and transfer pairs. Unsupported graphs must fail before writes. Plan coordinated transfer-pair collision handling rather than independently skipping a side and leaving invalid relationships. Investigate archived/incomplete-restore workspace eligibility and source history preservation separately; none is implicitly authorized by this plan. Backup merge remains a separate future entry point.
