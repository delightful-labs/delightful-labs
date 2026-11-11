# T006 stacked slice — one test app root record

> Historical slice/research record. The complete test app workflow, fresh comparison and activation
> are now implemented in PR #26. Use [the current task ledger](tasks.md#current-handoff) and
> [completion evidence](restore-completion-design.md) for present status; bounded single-step
> descriptions and dated test totals below describe their original scope.

Base: PR #23, `feat/notebook-restore-preparation` at `8b64ea7`. Implementation authorized
by “continue. make a pr stacked on 23”. Review before tests remains in force.

## Bounded behavior and ownership

Advance exactly one existing `record/notebook` batch at its retained mapping. The exact checked
profile admits one root with a text title. Preserve that string without normalization. Do not
allocate IDs, skip attachment steps, write notes, compare the full graph or activate anything.
A missing/different current step returns `noNotebookStep`; incomplete preparation remains incomplete.

Reuse the existing finite continuation chart through static pure domain capabilities, not a mode
flag in an I/O callback. Attachment and test app factories each bind their own current-step predicate,
expected-content projection and write-ID projection. Those functions perform no asynchronous work
or workflow selection. Statechart guards select eligibility. Private request data owns expected
content; its resource child clears references after the active child drains.

```text
notebook record continuation root
  claim -> own checked archive -> resume-only admission -> planning child
  -> exact recovery intent guard -> preparation prefix guard -> notebook-step guard
  -> prepare expected title -> journaled batch child -> finite output
    operation lock -> exact journal load/current-step guard -> write owner
      remote control + mapped notebook read -> content/issuance guards
      durable issued marker -> transaction acquisition -> transaction read
      -> eligibility guard -> stage single insert -> commit
      -> transaction ID -> local wait/checkpoint -> remote wait/checkpoint
      -> completion checkpoint preserving prefix -> stop
```

The common write actor retains responsibility for uncertain outcomes and interruption. Missing or
hidden data after issuance cannot authorize replay. A fresh exact match can reconcile only with the
required independent local evidence; the original attempt remains unchanged. CANCEL/SHUTDOWN and
current-generation INVALIDATE forward to active children and await their finite output. Read leaves
drain before expected content is released; committed native custody stays host-owned.

## Concrete destination contract

Add a disposable `restoreNotebooks` table: mapped ID, destination ID, owner ID, operation ID and title;
relation to the existing incomplete control row. A filtered reverse include reads the original control
and zero/one mapped test app in one SDK operation, both remotely and under the owned transaction.
Zod bounds observation shapes; pure named predicates compare exact scope, mapped ID, control hashes,
incomplete status and title. Missing/unreadable control is unavailable, not permission to recreate.

Insert policy requires current owner plus linked owner/operation/incomplete control. Read policy
requires owner and linked owner/operation. Updates/deletes remain denied. Mutation rechecks bound
identity/scope beside the single insert; admission is not remote acceptance. Leaves reuse existing
native acquisition/commit/settlement/rollback operations and issue no other workflows.

## Review and qualification boundaries

The title introduces no new SDK data representation: existing control rows already store scalar
strings and attachment qualification exercises filtered reverse includes. Nevertheless the new
relation/table/policies and extracted continuation chart need actual qualification after review.
Static checks do not establish runtime correctness. Planned qualification: prior 13 browser cases,
test app mapped title/prefix/same-browser reload, empty/Unicode/control-character titles, mismatching
title/scope, unknown-write recovery without replay, and actual new-table policy denials. Unit checks
should target shared admission/drain behavior where meaningful, not duplicate projections.

Material limits: no full graph comparison or activation; already-completed earlier steps are not
freshly reverified by this one-step continuation. Same-browser recovery only. No forced-crash,
Finance completeness or production restore safety claim. No automatic retry or destination replacement.

## Implementation prepared for review

- Added the resume-only `createTestAppRestoreRootMachine` and bound unstarted
  `createTestAppRootRestore` host factory. Exact title content stays in the private request capsule,
  alongside mapped IDs and the planned content digest, and is cleared by the resource owner.
- Extracted `restore-continuation.ts` from the attachment root, retaining explicit claim, resource,
  planning, recovery/preparation/current-step guards, expected-content projection and batch invocation.
  Static pure capabilities bind domain projection; no I/O mode dispatch, manual child startup,
  retry loop or conditional write workflow was introduced. Attachment API/result vocabulary remains.
- Added `restoreNotebooks`, its reverse control relation and owner/operation/incomplete-control
  insertion policy. The concrete writer has one bounded read per observation leaf and one insert
  in staging. It compares actual title and linked control scope, not merely stored hashes.
- Shared journal/write-step/transaction-custody machines and plan format are unchanged. Prior
  completed receipts, native uncertainty and independent settlement observations retain their owner.
  The test app factory stops before any note step and does not activate the destination.

Source review covered the complete changed actor tree, current-step correlation, single-use claims,
private title lifetime, invalidation forwarding, unexpected-error paths and the original transaction
owner. The only conditional in the mutation leaf is the atomic identity/mapping invariant immediately
beside insertion; eligibility/recovery/commit/rollback routing stays in the existing write chart.
Pure decoding and content classification contain ordinary bounded checks, as permitted by the memory.

Static validation passes: test app TypeScript, root Svelte/strict TypeScript, package build with strict
Publint, consumer TypeScript against rebuilt public declarations, Oxlint, Oxfmt and whitespace checks.
No implementation tests were added or run locally, and no live SDK/server operation was performed.
This is an implementation-review PR; runtime behavior is not yet qualified. PR #23's earlier passing
914/13 totals do not establish correctness of this extracted continuation or additive table/policy.

## Test app-root qualification — completed (2026-11-04)

The user approved implementation qualification with “continue” after the stacked implementation
review. The following current-tree evidence supersedes historical pending-qualification statements:

- **22 real Jazz/Chromium cases pass**, comprising all 13 preparation/attachment regressions plus
  nine test app-root cases against the concrete writer, actual schema/policies, rebuilt public
  package and native IndexedDB journal. No production-code correction was required.
- Three title cases exercise ordinary, empty and exact combining-Unicode/emoji/newline/CRLF/NUL
  strings. Fresh remote reads verify mapped IDs, scope and actual title. Completion preserves both
  preparation and attachment receipts, leaves the control incomplete, advances exactly one step,
  and survives reload with zero replacement commits and unchanged intent/mappings.
- Admission checks refuse missing journal/preparation, do not skip a pending attachment, and reject
  a different checked archive without replacing the retained journal. A conflicting actual title
  stops conflict without overwriting the row or advancing progress.
- An uncertain-write case holds only global acceptance observation after real commit/local
  persistence, separately observes the actual remote test app, cancels and reloads. Fresh content
  reconciles with remoteContentMatch and zero replacement writes, retaining the original transaction
  ID, issuance and separate local/remote observations rather than inventing acceptance.
- CANCEL and current-binding INVALIDATE during native staging leave the root active until the held
  stage settles, then roll back without committing or leaving a remote row. A mismatched-generation
  invalidation is ignored. The issued journal marker remains unresolved; subsequent continuation
  stays incomplete and does not replay. This slice deliberately does not add a rollback/retry protocol.
- Server-boundary checks observe actual PersistedWriteRejectedError/permission_denied for test app
  update, deletion, wrong-operation insert, missing-control insert and forged-owner insert. A foreign
  identity cannot read the owner row, and a fresh owner remote read preserves the original row.
- All **914 unit tests** pass, including the existing 31 focused write-owner/preparation cases.
  No redundant projection-only unit tests were added. Package/strict Publint, consumer compilation,
  public imports/builds and runtime checks (17 reader, 18 test app export tests), test app and root
  Svelte/strict TypeScript, lint, formatting and whitespace checks pass.

The disposable host at http://127.0.0.1:6199/restore.html, Jazz authority and Chromium were shut down
by test teardown. Qualification runs used synthetic data only. Scope remains one test app root;
note records/relationships, fresh full-graph comparison and activation are unimplemented. Earlier
completed steps are not freshly revalidated by this one-step continuation. No cross-browser/device,
forced-crash, offline restart, Finance completeness or production restore safety claim follows.

### Parent CI harness correction (2026-11-04)

The first PR #24 CI run timed out only the 1 MiB attachment case at 30 seconds; 21 other cases
passed. The harness now closes browser contexts after every test, compares every large-payload byte
inside Chromium instead of transferring a million-element actual array back to Node, and gives
that single large case a bounded 90-second timeout. All 22 real browser cases pass locally after
this correction; CI must qualify the pushed correction independently. Assertions and payload size
were retained, and this is not a restore performance guarantee.

## Post-merge machine review (2026-11-04)

The user authorized updating PRs 24 and 25 from main, implementation, tests and publication
for morning review. The shared transaction actor retains acquisition, journal intent, stage,
commit, independent settlement and rollback. Each destination invokes the shared live-identity
write machine for authority/staging. Test app admission checks owned expected data and mapping
before invoking SDK reads or writes; lost identity and observer failures drain issued staging
and produce finite results. Actual title comparison stays a pure projection over bounded SDK
observations, held privately and cleared on owner completion/failure. No stage callback throws
for ordinary scope changes. The continuation owns claim, planning, expected-content preparation
and one journaled write. Synchronous capsule operations are ordinary actions that report typed
events; they must not acquire resources at actor construction or simulate async work. Missing
owned requests finish unavailable without touching another actor's resources. Cancellation
forwards only control events and waits for issued child operations; release/error cleanup must
not bypass the transaction owner. Both existing protocol tests and native Jazz tests qualify
these paths after integration.

### Updated qualification

Merged `origin/main` at `f37669e`, retaining main's consolidated restore API and live-identity
destination actor. All 918 unit, 37 actual Jazz/Chromium restore, 65 Storybook browser,
10 private-creation, 17 independent-reader and 18 test app-export tests pass (1,065 total).
The restore set retains all main regressions and nine original test app-root cases, adding
request release during staging, latched identity loss/failure during staging, dormant actor
construction, released-request admission and absent expected-content admission. Stage gates
exercise actual native insertion before drain/rollback; identity tests inject observer reports.
Formatting/lint, root and test app TypeScript, Svelte checks, package/strict Publint, consumer
checks/builds and the Storybook build pass. A concurrent package rebuild triggered Vite reload
in one first-run browser case; the clean full rerun passed all 37 cases. Tests now run after
package construction to avoid this harness interference.

A released request keeps its private content until the owner drains. Claim refusal is a typed
finite path; a second actor cannot clear the first actor's resources. Planner capsule actions
also run only after actor start. Existing limits on unresolved issued writes, fresh whole-graph
comparison and activation remain unchanged; this does not qualify production restoration.
