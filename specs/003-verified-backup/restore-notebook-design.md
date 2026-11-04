# T006 stacked slice — one notebook root record

Base: PR #23, `feat/notebook-restore-preparation` at `8b64ea7`. Implementation authorized
by “continue. make a pr stacked on 23”. Review before tests remains in force.

## Bounded behavior and ownership

Advance exactly one existing `record/notebook` batch at its retained mapping. The exact checked
profile admits one root with a text title. Preserve that string without normalization. Do not
allocate IDs, skip attachment steps, write notes, compare the full graph or activate anything.
A missing/different current step returns `noNotebookStep`; incomplete preparation remains incomplete.

Reuse the existing finite continuation chart through static pure domain capabilities, not a mode
flag in an I/O callback. Attachment and notebook factories each bind their own current-step predicate,
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
and zero/one mapped notebook in one SDK operation, both remotely and under the owned transaction.
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
notebook mapped title/prefix/same-browser reload, empty/Unicode/control-character titles, mismatching
title/scope, unknown-write recovery without replay, and actual new-table policy denials. Unit checks
should target shared admission/drain behavior where meaningful, not duplicate projections.

Material limits: no full graph comparison or activation; already-completed earlier steps are not
freshly reverified by this one-step continuation. Same-browser recovery only. No forced-crash,
Finance completeness or production restore safety claim. No automatic retry or destination replacement.

## Implementation prepared for review

- Added the resume-only `createNotebookRestoreRootMachine` and bound unstarted
  `createNotebookRootRestore` host factory. Exact title content stays in the private request capsule,
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
  The notebook factory stops before any note step and does not activate the destination.

Source review covered the complete changed actor tree, current-step correlation, single-use claims,
private title lifetime, invalidation forwarding, unexpected-error paths and the original transaction
owner. The only conditional in the mutation leaf is the atomic identity/mapping invariant immediately
beside insertion; eligibility/recovery/commit/rollback routing stays in the existing write chart.
Pure decoding and content classification contain ordinary bounded checks, as permitted by the memory.

Static validation passes: notebook TypeScript, root Svelte/strict TypeScript, package build with strict
Publint, consumer TypeScript against rebuilt public declarations, Oxlint, Oxfmt and whitespace checks.
No implementation tests were added or run locally, and no live SDK/server operation was performed.
This is an implementation-review PR; runtime behavior is not yet qualified. PR #23's earlier passing
914/13 totals do not establish correctness of this extracted continuation or additive table/policy.
