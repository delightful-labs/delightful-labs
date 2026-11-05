# T006 next slice — one mapped note and its relationships

> Historical slice/research record. The complete test app workflow, fresh comparison and activation
> are now implemented in PR #26. Use [the current task ledger](tasks.md#current-handoff) and
> [completion evidence](restore-completion-design.md) for present status; bounded single-step
> descriptions and dated test totals below describe their original scope.

Base: PR #24 (`feat/notebook-restore-record`). The user explicitly authorized implementation and
tests together while away; this overrides review-before-tests for this slice only. No merge is authorized.

## State/resource design before implementation

Reuse the finite continuation and journaled batch/write charts without adding a note loop:

```text
single-use checked-file owner -> resume planning -> exact intent/preparation guards
  -> current record/note guard -> pure expected note/reference projection
  -> operation lock + journal load/current-step guard
  -> remote control/parents/mapped-note observation -> write/reconcile guards
  -> durable issued marker -> owned transaction -> same bounded observation
  -> stage one note -> commit -> transaction ID -> local persistence/checkpoint
  -> remote acceptance/checkpoint -> append one receipt -> stop
```

The note factory supplies only pure current-step/projection/write-ID capabilities. No callback
selects another workflow. The existing write actor owns decisions, transaction, rollback, settlement,
unknown outcomes and interruption/drain. Expected body/relationships remain in the private request
capsule, cleared after the invoked children drain. Snapshots contain no note body or actual SDK rows.

The existing immutable plan already places all attachments and the test app before notes. Project
source test app and optional attachment references through that exact retained mapping. Missing
mappings or unsupported fields cannot allocate replacements. Advance exactly one current note;
repeat invocation is an explicit host choice, not a retry engine. The last write may reach the
journal's comparing checkpoint; this is not comparison completion or activation.

## Destination writer and permissions

Add immutable restoreNotes rows with destination/owner/operation, notebookId, nullable attachmentId,
exact body and archived flag. Use actual Jazz relations to the control, test app and attachment.
Insert policy requires incomplete owned control and referenced parents with the same destination,
owner and operation. A null attachment requires no attachment row. Read policy retains owner/control
scope; update/delete are denied. This is the disposable test app lane, not Finance domain policy.

Each remote/transaction leaf executes one bounded control query with filtered zero/one note,
test app and attachment includes. Named pure shape/scope/reference/content predicates classify it.
A missing or unreadable required parent is unavailable, not permission to create it; wrong content
or binding conflicts. For null attachments the include uses the note's globally disjoint mapped ID
and must be empty. Stage performs one insert with both relationship IDs and checks identity/mapping
invariants beside mutation. Native commit/observations/rollback reuse the existing adapter.

SDK inspection: alpha.59 declares nullable `schema.uuid().optional()`, `anyOf/allOf` permissions and
`isNull` filters. New nullable-reference policy and multiple filtered includes need actual tests;
source inspection alone is not evidence they work. Tests must exercise both null and non-null paths.

## Bounded qualification and limitations

Qualify exact archived/empty/Unicode/control-character bodies, actual mapped shared/absent attachment
references, one-step prefix progression through comparing (never active), reload without replay,
unknown-write reconciliation preserving attempts, conflicts, missing parents, cancellation/drain,
and server rejection of cross-destination/operation/owner references and mutation/deletion. Re-run
preparation/attachment/test app regressions plus shared units and package/consumer/static checks.
No automatic replay, replacement destinations, full fresh graph comparison, activation, cross-device
recovery, forced-crash/offline durability claim, Finance completeness or production safety claim.
Earlier completed fields/attachment bytes are not freshly compared by this one-note writer; parent
reads establish relationship presence and scope only. Full comparison is a separate next slice.

## Implementation and qualification — completed (2026-11-04)

The note continuation binds only its current-step guard, pure expected-field/mapped-reference
projection and write ID into the existing chart. The plan, shared continuation, journal, write-step
and transaction-custody machines are unchanged. The private request owns and clears expected note
content. The concrete writer performs one three-include remote/transaction query per observation
and one insert in staging; named pure predicates classify scope, parent presence and actual fields.
The additive table's server policy requires actual scoped parents, including its null-reference path.
Source review covered issued-call drain, expected-content lifetime, correlated binding admission,
unexpected-error paths, preserved prefixes and the single transaction boundary. No app-owned class,
procedural async coordinator, auto-retry, replacement mapping or domain adoption was introduced.

**30 real Jazz/Chromium cases pass** against the rebuilt public package, actual writer/table/policies
and native IndexedDB journal: all 22 prior regressions plus eight note cases:

- Sequential explicit invocations write archived, empty and Unicode/newline/CRLF bodies exactly;
  both shared attachment references and null are verified at mapped IDs. Each invocation appends
  exactly one receipt, preserves the prior prefix and intent, and stops. The last reaches comparing,
  leaves the destination incomplete, and reload returns noNoteStep with zero replacement commits.
- A pending test app cannot be skipped and another checked file cannot replace the retained intent.
- Independently seeded body and attachment-reference conflicts remain conflict without overwriting
  data or advancing the journal, even though the seeded rows were accepted by the server.
- A held global observation after actual commit/local persistence is cancelled only after a separate
  remote read proves the note exists. Reload reconciles fresh fields/references with zero replacement
  commits, preserving the original transaction ID, issuance and unobserved acceptance as attempt facts.
- CANCEL/current-binding INVALIDATE during native staging await the issued stage, then roll back
  without commit/remote row; mismatched binding invalidation is ignored. The issued journal marker
  remains unresolved and subsequent continuation stays incomplete without replay.
- Actual PersistedWriteRejectedError/permission_denied is required for cross-destination test app
  and attachment links, missing notebook/attachment rows, wrong operation/owner, update/delete and
  foreign forged-owner insertion. Foreign reads are hidden; fresh owner reads retain the original.

All **914 units** pass, including the 31 shared preparation/write-owner cases. No redundant
projection-only units were added. Package/strict Publint, public consumer compilation/imports/builds
and runtime checks (17 independent reader and 18 test app export tests), test app and root
Svelte/strict TypeScript, Oxlint, Oxfmt and whitespace checks pass. The disposable Jazz authority,
Vite host at http://127.0.0.1:6199/restore.html, browser and per-test contexts were closed by teardown.

Before stacking, parent PR #24's first CI failure was traced to the 1 MiB fixture's 30-second test
limit. The separately published parent fix `81ba2d6` reduces transfer/comparison overhead, releases
per-test contexts and bounds only that large case at 90 seconds; its GitHub CI passed. The new note
slice retains that correction and passes all earlier cases without weakening byte assertions.

Limits remain material: parent reads verify presence/scope, not fresh test app fields or attachment
bytes; full comparison must do that independently. Missing-parent server denial is exercised, but
external deletion/loss of an already completed parent was not induced through the immutable API.
A rollback-issued marker is conservatively unresolved, without an automatic retry protocol. This
qualifies one-note continuation and its concrete relationships, not the complete restore coordinator,
full comparison, activation, Finance completeness, offline restart or production restore safety.

## Post-merge machine review (2026-11-04)

The user authorized updating both PRs from main, fixes, tests and publication for morning
review. This branch incorporates main through the updated test app-root parent. Notes adopt
the consolidated transaction/destination protocol: the shared write actor owns journal intent,
transaction custody, commit, independent settlement and rollback; a note destination borrows
its transaction for one operation. Expected scope/mapping and observed control/parent/note
facts are admitted by guards and explicit states. Observations live in private bounded buffers
with owner cleanup. Identity admission/staging invokes the common live-observation actor and
latches identity loss/observer failure until issued staging drains. Scope changes produce finite
results, with no business-policy throw inside a stage callback. The shared continuation owns
claim, plan, synchronous expected-content preparation and one write. Request release drains
before private content clears. Qualify exact note content/relationships, no replay, stale scope,
cancel/release/invalidate, observer loss, unstarted construction and missing expected admission
using existing native boundaries and additional regression cases. Full comparison/activation
remain outside this one-step writer.

### Updated qualification

This branch includes main at `f37669e` through the updated PR #24 branch (`c6352c6`).
All 918 unit, 51 actual Jazz/Chromium restore, 65 Storybook browser, 10 private-creation,
17 independent-reader and 18 test app-export tests pass (1,079 total). The restore suite
retains all 37 updated parent cases and eight original note cases, with six additional note
regressions: release during issued staging, latched identity loss and observer failure, dormant
construction, released-request admission and missing expected-content admission. The five
note drain paths assert native staged insertion, no premature completion, private-content
retention through drain and clearing afterward, rollback/no remote row, retained prior prefix
and no automatic replay. Identity cases inject typed observation reports; ordinary note writes
and relationship-policy denials execute against the real SDK/server.

Formatting, lint, Svelte/root strict TypeScript, test app/private-creation TypeScript,
package/strict Publint, consumer checks/builds and Storybook build pass. No whole-graph
comparison, activation, production restore or cross-browser/offline/crash qualification is
implied. Source assertions in checked-content projections remain pure invariant checks;
the owning action catches projection failure and reports a finite continuation result.
