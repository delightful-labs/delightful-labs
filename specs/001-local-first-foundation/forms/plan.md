# Shared scoped forms: contracts and readiness first

## Evidence and first implementation boundary

Following the reviewed Finance extraction inventory, extract Finance main e04bdf4's
contracts/form-contract.ts and machines/forms/scoped-form-readiness.ts. This first review adds SDK-
independent contracts and the existing policy-observer/assessment actor, under forms/contracts and
forms/readiness. Finance source and its package dependency remain unchanged until shared coverage
and the next focused adoption review. No generic form controller, submission, persistence workflow,
DUI wrapper or localization implementation is moved in this batch.

Finance's current contract imports FormFeedbackLabel, whose callbacks depend on its rendered form
feedback inputs. The shared base ScopedFormView deliberately excludes that optional decoration.
Finance may retain its feedbackLabels extension when it adopts the core contracts; do not import
Finance translations or catalogs into the library. Existing result, partial result, settlement,
recovery checkpoint, interruption, dirty baseline and draft-revision contracts otherwise retain their
shapes. formInterruptionResult is a pure transformation preserving settlement/checkpoint evidence.
It neither cancels a write nor establishes that a resource was released.

## Statechart and recursive machine-first audit

Readiness ownership: observing/selecting -> observing/watching or observing/assessing -> assessed
or failed. Invoke one consumer-supplied availability actor. Its observations and public projection
are the sole domain policy source; the shared actor does not decide roles, validate schemas, query
storage, or wait for remote freshness. The supplied policy/projection/scope helpers must be pure,
local decisions over supplied facts, not hidden I/O or orchestration.

Watch mode forwards current observations to the active policy child. It publishes only a capability
whose observation revision and exact consumer scope match; every report carries the watch owner's
generation. One-shot mode returns the matching capability with the original request ID, scope
revision and assessment generation token. The parent must still check these tokens and ignore late
reports from a replaced child. The wrapper does not become a second scope or authorization owner.

Source actor errors or unexpected completion explicitly finish failed. A throwing public projection
or scope helper retains Finance's current actor-error behavior; the invoking parent must supervise
that error rather than treat it as an allowed/blocked verdict. Do not silently change that contract
while extracting it. Existing Finance scoped-form-write includes assessment-error supervision.

There is no promise actor or async helper in this extraction. PROJECTED is a typed internal
projection event; revision/scope checks are guarded transitions. The projection raise and observation
forwarding are synchronous actor actions. Publication branches on watch delivery only, with no
acquired resource, transaction, cleanup workflow or hidden sequential effect. No new lifecycle
flags or alternative authorization implementation is added.

The invoking form owns readiness retries and lifetime. This observer owns only its invoked pure
policy actor, which is stopped when the observer ends/stops. It owns no SDK subscription, issued
write or acquired handle. FormChildEvent includes interruption commands for the broader form
protocol; this extracted observer retains the original handling rather than inventing new effects
for commands currently owned by its parent. Future submission/write owners must still drain actual
writes before stopping their resource owners. Do not reuse this stop rule for an I/O-owning actor.

## Local-first and integration boundaries

Inputs carry typed consumer facts and opaque scope identity; no client, table, membership schema,
route, translated text, browser global or remote-readiness signal is introduced. Loading, denied and
unavailable facts remain consumer policy reasons; observing/failed states stay distinct from a ready
capability. The operation contracts preserve local durability, confirmed authority acceptance,
rejection and unknown settlement as separate values, including partial and interrupted outcomes.

Actor-free contracts import no XState/Svelte/Jazz modules. forms/readiness imports only XState and
the shared type contract. No new peer dependency, global theme, catalog, generation step or SDK
version change is needed. The full form machine's feedback metadata and validation/completion
orchestration require their own subsequent extraction review.

## Review and coverage after approval

Add actor-free NodeNext/runtime contract imports and a domain-free packaged readiness consumer.
Cover watch delivery, one-shot token preservation, immutable revisioned facts, stale revisions,
wrong scopes/bindings including A -> B -> A, stale generations at the consuming owner boundary,
blocked versus ready, failed/completed source actors, throwing public projections, source-child
teardown and independent consumers. Inspect Finance's existing readiness/form-write fixtures before
adoption instead of running tests to discover obvious protocol drift.

After shared implementation approval, add/run that coverage and package verification. Finance
adoption should re-export compatible core protocols with its optional feedback decoration and
replace the observer through a narrow import, preserving all domain policy and existing call sites.
Review that adoption before running its affected tests. Do not move all generic forms at once.

## Static review status

This batch implements the core contracts, the unchanged readiness actor and two package subpaths.
No implementation tests have been added or run, no Finance source changed, and nothing has been
committed or published. Static checks are recorded below when complete.

Static verification passes: TypeScript, focused Oxlint/Oxfmt, diff checks, Svelte package generation
and strict publint. Package verification initially exposed an inferred reference to XState's private
AnyActorSystem type. Named public delivery/input/availability-logic aliases now keep declarations
resolvable entirely through the public xstate entry point without casts or a hand-written declaration
shim. The factory retains its normal machine return type; state paths are implementation details,
not a supported consumer protocol. The extracted statechart runtime is unchanged.

This is implementation-review evidence only. No unit/browser/consumer test was added or run, no
Paraglide compilation was invoked and Finance still uses its original readiness implementation.

## Approved shared coverage

The user authorized the implementation commit and continuation. Implementation and the reviewed
extraction roadmap are committed as f5dfed9. Sixteen focused cases pass: ready/blocked assessments
preserve the original token and scope; watch reports carry the owner's generation; stale/future
revisions and wrong/replaced bindings are rejected, including A -> B -> A; independent watchers stay
separate; policy crashes/completion produce failed outcomes; throwing projections retain actor-error
supervision; stopping the observer disposes its invoked policy source; interruption preserves
notStarted/local/unknown settlement and recovery checkpoints without inventing rollback.

TypeScript, focused lint/formatting and diff checks pass. Package/publint and the public consumer
checks pass: NodeNext declarations resolve the public contracts/types; a domain-free Node consumer
runs the one-shot readiness protocol without a Jazz client, Svelte or browser context; the existing
public Svelte consumer still builds. No production correction was needed during coverage.

These actor-only changes add no user-visible interaction or SDK storage behavior, so browser/Jazz
qualification belongs to the subsequent Finance adoption. Finance remains unchanged on its fresh
branch. Next, re-export the shared core contracts with Finance's optional feedback-label decoration
and replace its readiness module with the public factory import; keep form/write owners, role/schema
policies and existing integration lifetimes intact. Review that change before running its affected
readiness/form/profile/permission coverage. The remaining form submission/write/controller extraction
stays a later focused review rather than moving the whole framework at once.

Coverage and this qualification note remain uncommitted. No catalog/generated localization change,
server startup, branch push, PR or publication occurred in this continuation.
