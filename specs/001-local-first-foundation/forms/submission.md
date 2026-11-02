# Shared scoped form submission: implementation review

## Baseline and responsibility

Extract Finance main e04bdf4's existing scoped-form-submission actor on the current
feat/finance-foundation-extraction branches. The verified contracts/readiness adoption remains
uncommitted in Finance; do not replace it or silently include submission in its qualified artifact.
This review adds the library submission actor, a structural parser contract and a package entry.
Finance submission source, dependency archive and tests remain unchanged in this batch.

The existing owner takes an explicit request (ID, scope, scope revision, raw values/checkpoint), a
revisioned observation and optional progress recipient. It owns validation, operation invocation,
interruption priority, result classification and transient-input cleanup. It does not own schemas,
role policy, SDK effects, navigation, translated feedback or the form's dirty/reset lifecycle.

## Statechart and machine-first audit

validating/pending -> operating/pending -> classifying -> finite result. Both validating and
operating have cancelling/invalidated/closing states. Shutdown outranks invalidation, which outranks
cancellation. Validation is one invoked leaf: await the supplied parser. An interruption retains that
invocation until it settles and then prevents operation start. Late validation errors cannot replace
an already-requested interruption with invalid/failed UI. Validation receives no SDK handle.

On validation failure, call one supplied pure normalizer and store one typed result; route invalid
versus failed through the classifying state's guards. Undefined issues mean unexpected failure;
an issue array (including an empty array) means invalid input. No promise actor hides classification
or policy: the parser is a leaf and normalization is a synchronous pure transformation. The factory
adds no catch/read/write sequence or callback transaction. A throwing normalizer remains an actor
error for the invoking supervisor; never silently grant readiness or start an operation on failure.

The operation is an invoked consumer-supplied statechart with its own resource/permission/persistence
ownership. It receives validated values, the unchanged request identity/checkpoint and the latest
observation. During operation, observations and interruption commands are forwarded only while its
actor is active. The parent waits for a finite result, preserving partial completion, local/confirmed
settlement, uncertainty and recovery data. An unexpected operation error maps to unknown settlement;
it does not certify rollback or trigger automatic replay. No manual createActor/promise bridge.

Every terminal route clears raw/validated values, checkpoint input, observation and recipient from
the submission context. The actual typed result may retain its own recovery checkpoint or output
required by the consumer. Clearing transient input is not proof of cancellation or disk erasure.
Parent callers must drain before stop; raw actor.stop cannot cancel issued writes or async parsers.

Progress messages retain requestId and scopeRevision. The receiving owner still checks both against
its current request and generation before rendering progress; a late old-scope report is not current
readiness. The submission actor does not become a second form or authorization owner.

## Validation without a schema-library dependency

Finance uses Zod. The library accepts FormSchema<Values>, a parseAsync leaf, plus validationIssues,
a pure native-error-to-core-issues normalizer. This preserves Zod-compatible parsing/transforms and
issue metadata without importing Zod, Finance validators or catalogs. A later Finance wrapper supplies
its current ZodError mapping, while consumers keep their own validation policy. No new peer needed.
Existing production validation refinements/transforms inspected in Finance are synchronous pure
checks/transforms; test-only async gates model validation lifetime. A future I/O/resource workflow
must not be hidden in a parser or normalizer under this API.

The one intended internal routing change is that normalized invalid results pass through the common
classifying state before their existing terminal outcome. There is no additional async work,
remote gate or visible step. All parsing/normalization remains caller-supplied and independent of
connectivity. The shared operation callback uses a named public logic alias for portable declarations,
as in the readiness factory; raw inferred private XState system types must not leak into the package.

## Review and subsequent coverage/adoption

After implementation review, cover transformed values and latest observations; invalid versus thrown
validation errors; progress correlation; interruption during pending validation and operation;
shutdown precedence; partial/local/confirmed/unknown outcomes; operation crashes; preserved recovery
checkpoints and cleared transient context. Add a domain-free packaged consumer using its own simple
parser and operation, plus public declaration imports. No browser test is required for an unadopted
actor-only boundary; real Finance form/persistence qualification follows its own implementation review.

Finance adoption later replaces only its submission module with a wrapper supplying the current Zod
issue mapping, and refreshes its vendored archive. Keep the form/write/controller owners unchanged.
Inspect existing submission/progress/readiness fixtures before executing them after approval. Do not
copy untranslated default validation text, regenerate Paraglide, or require the next app to import
Finance's schema/message modules. This is one further extraction slice, not the completed form stack.

## Static review result

Implemented the structural FormSchema contract, named public input/operation-logic types, submission
factory and forms/submission export. TypeScript, focused Oxlint/Oxfmt, diff checks, package generation
and strict publint pass. Emitted declarations use public XState types, with no Zod/Finance/SDK import.
No implementation tests have been added or run before this review. No Finance submission source or
vendored artifact changed; the separately verified Finance readiness adoption remains uncommitted.

## Approved shared submission coverage

The user approved continuation after the implementation review. Thirty focused cases pass, covering
transformed values and latest/live observations; optional progress recipient and request/scope
correlation; normalized nonempty/empty issue arrays versus unexpected parser failure; throwing
normalizer supervision; successful/rejected validation after each interruption; operation draining;
shutdown/invalidation priority; local/confirmed/rejected/unknown and partial outcomes; operation
crashes; retained recovery checkpoints and cleared transient inputs. No production correction was
needed during coverage. The issue-table fixture uses named rows so the runner passes an issue array
as one value rather than spreading it into test arguments.

TypeScript, focused lint/formatting, diff checks, package generation and strict publint pass. Public
consumer checks pass: NodeNext declarations expose parser/input/operation types, a domain-free Node
consumer runs successful and invalid submissions using its own parser and a typed finite operation
statechart, and the existing Svelte consumer still builds. The consumer operation invokes a promise
leaf within its statechart; it implements the child-event protocol rather than passing a raw promise
actor with an incompatible event surface. No casts, schema library, SDK client or browser context.

Finance remains on the separately verified but uncommitted contracts/readiness adoption. No Finance
submission source, vendored artifact, tests, generated localization or server changed in this cycle.
Shared submission implementation and coverage remain uncommitted. Its next focused adoption review
will retain Finance's Zod schema/issue mapping behind a small local wrapper and keep the existing
form/write/controller owners. Inspect the original submission/progress fixtures and relevant domain
form checks after that implementation is approved. The remaining shared write/controller extraction
is still outstanding; these results qualify only the submission boundary.
