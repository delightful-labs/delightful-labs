# Private creation: local transaction ownership

First batch: reusable transaction ownership only; implementation approved and focused coverage complete. Name validation, stable ID allocation,
recovery journals, unknown-write reconciliation, Jazz policy/schema bindings, and Finance adoption
follow after review. Explicit creation must not be inferred from an empty replica. Automatic
new-identity bootstrap remains outside this capability.

## Local-first boundary

The host supplies one immutable attempt identity and stable workspace/membership IDs, plus a
prepared domain draft. It must durably record recovery information before invoking this owner.
The owner opens a mergeable transaction, reads local records, makes a pure eligibility decision,
stages one atomic bundle, commits, and awaits local persistence. It never waits for server
acceptance, requests remote permission advice, selects a workspace, navigates, or starts at app
startup. Jazz synchronization may proceed independently; later server rejection remains a host
observation and must not be described as confirmed acceptance.

The host supplies leaf operations: open, readLocal, assess (pure), stage, commit, persistLocal,
rollback. A leaf must not conceal a read/check/write workflow. Finance's additional-workspace
adapter will stage its organization, owner membership, and starter categories in the same bundle;
its automatic bootstrap and profile-provenance workflow remain native.

## Statechart before effects

Two independent regions model control (active → cancelling → closing) and work:

open → check interruption → readLocal → assess → stage → check interruption → commit → persistLocal.

- Opening/read/stage retain acquired resources until completion. Interruption before commit rolls
  back; no late result may start a commit.
- Once commit is issued, keep its outcome and local settlement alive through interruption. Do not
  treat cancellation as proof that writes did not happen, and do not retry uncertain commits.
- A commit or local-settlement failure remains unresolved even if a later rollback reports success.
  Before commit, rollback failure also makes the outcome unresolved.
- Eligibility failure rolls back and returns a typed blocked reason. Opening failure needs no
  rollback. Other pre-commit failures attempt rollback before returning failure.
- Success, blocked, failed, cancelled, and closed are terminal states. Results distinguish notStarted,
  locallyPersisted (with the workspace), and unresolved. Every result retains the original attempt.

No implicit retry is exposed. The host reconciles an unresolved attempt using the same IDs before
invoking another transaction. The caller must use CANCEL/SHUTDOWN and await output before stopping
this owner; raw actor.stop() is not a cleanup protocol.

## Approved verification scope

Affected coverage: new statechart tests for local-only operations, atomic eligibility, stage/commit
failures, opening/read/stage interruption, commit/settlement drain, rollback failure, and stable
attempt retention. Package consumer checks must cover actor-free contracts and workflow imports.
Finance adoption must exercise offline creation, an unanswered remote, local save/reload,
exactly-once recovery, conflicts, and later authority rejection under actual permissions.

Baseline audit: Finance main 48b0284 and library main c0f9f63. Session acquisition has no app remote
preflight; initialization reads LocalFirst before conditional authoritative provenance discovery.
Do not remove duplicate-prevention safeguards to hide a startup delay. Qualification of existing
cold startup does not prove private creation or explain all startup latency.

## Implementation review status

Implemented the actor-free attempt/result/leaf contracts, a generic resource-owning transaction
statechart, and separate package subpaths. The user approved implementation before creation tests were added or run. Type/Svelte checks,
focused lint, formatting, package validation, and public-consumer checks pass. Finance's production cold-start tests exercise existing merged behavior, not this new owner.

The recursive actor audit finds only leaf SDK-boundary calls in the wrappers; eligibility is a pure
assessment whose result is routed by guards. Control remains in parallel cancelling/closing states,
not duplicated context flags. Acquired transactions survive cancellation until rollback or issued
commit/local settlement finishes. There is no implicit retry, automatic bootstrap, selection,
navigation, or server-acceptance dependency.

## Coverage qualification

All 22 focused transaction-owner tests pass. They verify one transaction/attempt through the leaf
operations; local-persistence gating; blocked eligibility; pre-commit operation failures;
commit/persistence uncertainty surviving successful rollback; cancellation/shutdown while opening,
reading, staging, committing, or persisting; shutdown priority during cancellation; and unresolved
rollback outcomes. The tests retain attempt identity and prohibit commit replay after interruption.

The package consumer resolves both new subpaths with NodeNext, executes creation standalone in Node
without Jazz or Finance, and retains the existing public-consumer runtime and Vite build checks.
Source/Svelte types report zero errors and warnings. This uses a synthetic capability: it does not
qualify the future Jazz adapter, real storage durability, Finance policy admission, journaling, or
later remote rejection. Finance adoption must test those boundaries explicitly.

Next focused review: the approved core and this coverage, followed by a Finance-owned Jazz leaf
adapter for additional-workspace creation. Preserve its existing journal, starter records, one
mergeable transaction, explicit local reads/local waits, and native bootstrap workflow. No changes
to app startup, remote acquisition, routing, or presentation are needed for that adoption seam.

## Finance implementation proposed for review

Finance now has a Jazz leaf adapter invoking the packaged shared transaction owner for additional
workspaces. Database-bound factories preserve the existing operation/journal/reconciliation path;
bootstrap stays native. The vendored snapshot replaces the selection-only archive. Production-only
source checks and the app/service-worker build pass in an isolated checkout. Existing unit fixtures
need factory import/mock migration after review; real-policy, offline, and recovery qualification
remain pending. This is not a claim that the Finance adoption's full tests currently pass.
