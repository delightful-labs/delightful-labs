# Shared form contracts and readiness: Finance adoption review

Baseline Finance main e04bdf4, library main ed96a79; branches feat/finance-foundation-extraction.
Shared implementation/roadmap commit f5dfed9 and approved coverage commit 47fc8b0 are complete.
This batch adopts only the shared core protocols and readiness observer, not the whole form stack.

## Focused implementation

contracts/form-contract.ts re-exports the shared operation, observation, request, settlement and
presentation contracts plus formInterruptionResult. Its ScopedFormView aliases the shared base and
adds Finance's existing optional feedbackLabels callback decoration. This keeps translated feedback
and its inputs in Finance without changing the call sites or introducing a library catalog dependency.

machines/forms/scoped-form-readiness.ts re-exports the shared factory under the existing name.
The duplicated statechart is removed rather than retained as a fallback. Existing readiness/writer/
submission/controller consumers, domain availability actors, policy selectors and scope helpers do
not change. No page, control, CSS, schema or localized wording is modified.

## Ownership and recursive audit

The imported readiness actor is the reviewed existing observer: invoke one supplied policy actor;
watch current facts or return a one-shot assessment; guard matching scope/revision; echo the owner's
generation/token. Policy failure/completion and projection-error supervision retain their existing
semantics. Finance still owns source observations, permission/validation policy, invoking form lifetime,
readiness retries and supervision. Its form submission/write actors still own issued-work draining.

No new actor or orchestration is written in Finance: the local readiness module is a re-export and
the contract file contains types/re-exports only. The existing form-view selector now types only the
snapshot properties and capability-check events it actually consumes, instead of requiring invariant
concrete XState machine internals. Its body and decision logic are unchanged; this resolves generic
inference differences across the packaged boundary without casts or edits to domain consumers. The shared factory's source, projection, guarded
matching, observation forwarding and synchronous publication were audited and qualified separately.
Its policy child owns no SDK subscription/issued write and is disposed with the observer. This does
not justify stopping Finance's separate resource-owning operations without their drain protocol.

Local persistence, authority confirmation, later rejection, unknown outcomes, partial results and
recovery checkpoints retain their existing shapes and meaning. Aliasing a type grants no access.
The policy actor still makes authorization/readiness decisions from supplied local facts; no query,
network preflight, remote freshness gate, competing client or additional observer is introduced.

## Package and isolation

vendor/delightful-local-first-0.0.0-form-readiness.tgz replaces the naming archive. Manifest and lock
reference only the new artifact, with no dependency version or unrelated lockfile metadata changes.
SHA-256: `cee265fae1b8f9cf66114f8004919c95c32eb8b5ac5723790a0a8213d068dd2d`.

Static checks use /tmp/finance-forms-review.j415s_q_ with its own node_modules and existing generated
localization. Frozen installation skips lifecycle scripts; raw sync/check commands avoid Paraglide
prehooks. No catalog/config/generated file edit or regeneration is authorized or needed. No server
is started and user data/storage/environment is untouched.

## Review and affected tests

This changes a common entry point used by every scoped form. Before execution after review, inspect
existing forms/readiness, submission, completion, progress, single-write and controller fixtures for
shared type/actor compatibility; update only actual drift. Keep readiness generation and A -> B -> A
checks, failed policy/projection supervision, interrupted-result checkpoints, prewrite local policy
checks and issued-write settlement assertions intact.

Cover representative domain consumers: workspace naming and creation, profile editing, management
and account entry, plus existing transaction/transfer interruptions where they instantiate the shared
readiness factory. A complete serial unit run is justified here because the imported contracts and
observer are used across the generic form stack and domain policies; do not use it to discover
obvious fixture mismatches that static inspection can reveal.

Inspect targeted form-presentation, workspace naming and profile/identity browser cases before
running them. Keep permission-denied and offline saves, stable controls/feedback, dirty/reset,
readiness retry, scope replacement and cleanup. Reuse the strengthened cold offline/stalled-server
cases for actual ordinary saves, without asserting startup performance has been diagnosed. Do not
run every unrelated browser suite for this import-only adoption.

Shared qualification already passes sixteen unit cases, TypeScript, lint/formatting, package/publint
and public NodeNext/runtime/Svelte consumers. Finance adoption tests remain pending implementation
review; no test changes or execution are included in this batch. Static results are recorded below.

## Static implementation verification

Frozen isolated installation succeeds against the reviewed archive. Full source-and-test Svelte
checking reports zero errors/warnings after the selector input was narrowed to its actual projection
surface. Browser-test and service-worker TypeScript checks pass. Focused formatting and diff checks
pass. The generated localization tree remains byte-identical between the original checkout and the
isolated copy. No Finance adoption tests or fixture edits were added/run before implementation review.
Finance source/dependency changes remain uncommitted and nothing was pushed or published.

## Approved Finance qualification

The user approved continuation after implementation review. Static fixture inspection found no
protocol/assertion drift: the imported actor preserves the original factory, child source name,
revision/scope/generation checks, error supervision and result shapes. Existing coverage was reused;
no test fixture or assertion change was needed.

The complete serial Finance unit run passes: 126 files, 1,761 cases. This covers domain policies,
readiness and form supervision, profile/management flows, transactions/transfers and real Jazz storage
permissions. The initial sandboxed attempt could not bind Jazz's disposable test-server listener;
a focused diagnostic confirmed that environment error. The permitted isolated run passes without
source changes, relaxed assertions or increased deadlines.

All sixteen focused browser scenarios pass: form readiness withdrawal/recovery, scope replacement,
validation/pending/reset, draft dismissal, account creation, workspace owner/admin versus member/viewer
settings access, profile editing/recovery, offline avatar editing and offline settings persistence.
Both strengthened production cold cases pass: offline and open-but-unanswered connections retain
ordinary reads/writes and created/selected workspaces; after saving name/currency, every client exits
again and the retained profile recovers both settings and selection.

Full source/test Svelte checking reports zero errors/warnings; browser-test and service-worker types,
formatting and diff checks pass. Generated localization remains byte-identical. All execution used
the disposable checkout and temporary compiler-hook-preserving runtime runners described above.
The known agent server was stopped before production build and the runner preview has exited. The
user's dev environment, Jazz data and browser storage were untouched.

No production correction was needed during qualification. Finance adoption and this note remain
uncommitted; no push, PR or deployment occurred. This completes the contracts/readiness slice, not
the remaining form submission/write/controller extraction or a startup-latency diagnosis.
