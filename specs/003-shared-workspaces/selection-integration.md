# Production selection and access-lease integration

Baseline: commit `090e33b5`, Jazz alpha.67 and XState 6.0.0-beta.1.
This design continues the qualified shared initializer/startup work. It does not
claim that either production worker already consumes workspace selection leases.

## Findings from the active Finance worker

`worker-application.ts` accepts `SELECT_CONTEXT` with a UI selection revision,
workspace ID and transaction route context. It retains `readBinding` when the
workspace, transaction kind and transaction ID are unchanged. A query restart can
otherwise replace that read binding while preserving the session-bound forms
owner. A route revision is therefore not a workspace activation identity.

The forms owner is created once per ready native binding. It contains shared
startup/seeding, integrity, profile controls, workspace creation/navigation and
workspace financial operations. It forwards new observations to domain actors;
those actors retain their own issued operations through scope changes. Its full
shutdown protocol awaits the individual domain receipts before final closure.
Observing a new workspace is not that shutdown receipt.

The query owner also currently combines identity/profile/directory observations,
target-specific membership/workspace observations and financial content reads.
Target-specific access evidence must remain observable while access is unknown
or denied; placing its source behind an already-selected lease would deadlock
admission or prevent later revocation from being observed.

The old `workspace-selection-attachment.ts` is not a production owner. Moving it
alone would leave these responsibilities unchanged. Likewise, adding a selector
as an observer while continuing to admit resources through the old decisions
would not establish shared lifecycle ownership.

## Ownership boundaries

| Lifetime | Shared responsibility | Finance binding | Clipper binding |
| --- | --- | --- | --- |
| Native identity/client attachment | Existing shared session runtime; shared startup/seed owners | Identity controls, initialization, profile/directory observations and creation | Existing automatic root initialization and explicit extension sign-in admission |
| Target/access observation | Existing shared selection input contract and its generation checks | Explicit route target plus native workspace/membership evidence | Explicit canonical workspace target plus native private-root evidence |
| Selected workspace activation | Existing `createWorkspaceSelectionMachine` and `WorkspaceLease` | Financial content/form resources for the admitted workspace | Records/library/capture resources for the admitted workspace |
| Admitted domain work | Domain operation owners; shared selection waits for their aggregate drain receipt | Financial writes, bank work, backup/restore and native subscription release | Capture, annotation, reader/search/background work and native subscription release |

Finance retains route interpretation, membership/grant policy and money rules.
Clipper retains its canonical-root schema and ownership checks. Sharing selection
does not require common schemas or create cross-app membership.

## Correlation and readiness

- A selection scope uses the native binding and a distinct attachment object.
  A new attachment follows native binding replacement only after the old shared
  selection/resource owner has returned a terminal drain receipt.
- A request's attempt changes on target selection/retry, independently of the UI
  route revision. Same-workspace route/form updates retain the workspace lease;
  their own read/form scopes can still change underneath it.
- Finance supplies target-specific allowed/denied/unknown/failed evidence from
  its native workspace and membership facts. Directory absence is not denial.
  Readable local access does not wait for remote directory completeness.
- Clipper passes an explicit workspace ID to content construction. Native
  identity and workspace IDs remain separate inputs even while canonical policy
  requires equal values. Root bootstrap is not itself an ongoing access grant.
- Scope, request, observation generation and lease epoch all participate in
  admission and result checks. A → B → A must not revive old A capabilities.
- Global Finance routes remain usable without selecting a content workspace.
  Suspension withdraws selected-resource admission; it does not sign out the
  identity or prevent profile/workspace creation controls from working.

## Shared resource composition

Reuse the existing selector instead of introducing another target-selection
algorithm. Any additional shared composition must own only the demonstrated
resource boundary: admit one resource group for a selected lease, invalidate it,
request its shutdown once, consume its terminal receipt and acknowledge the
selector's exact drain token. It must not copy app operations or native SDK
ownership into a second session runtime.

The resource group is an app-owned actor with a typed input, command protocol and
terminal settlement result. Keep its concrete type at its producer, using the
installed supported invocation/spawn contracts. Preserve source injection; no
`AnyActorRef`, casts, event bus or generic command registry is needed. Domain
commands continue to target their existing typed actors after admission.

| State/fact | Required behavior |
| --- | --- |
| Waiting for target/access | Keep identity and access observers alive; allocate no selected content resources. |
| Selected lease | Construct one domain resource group for that lease. Local permission is sufficient for local usability. |
| Same-workspace route update | Retain the lease; pass the route facts to the admitted resource group. Do not turn each route revision into a new selection. |
| Target/access/native binding invalidated | Withdraw admission immediately, retain original resources and intent, and request domain drain once. |
| Draining with newer requests | Retain the latest target intent while awaiting the old lease's exact receipt. New facts cannot revive the old activation. |
| Successful resource drain | Acknowledge the matching selector drain token; only then may another activation begin. |
| Unknown settlement, resource crash or disposal failure | Retain the original resources/receipt and report unresolved release. Do not start replacement or acknowledge clean native close. |
| Shutdown during replacement | Shutdown takes priority; late selected/access reports cannot restart work. |

Access observers outlive the selected resource group. Content subscriptions and
operations drain with their group. Actor stop, a changed `OBSERVE` payload, an
empty child list or a timeout cannot replace the actual resource-drain receipt.

## Implementation and review batches

1. Extract Finance's current observation callback lifetime to DLF's
   `data/observation-workflow`; consume it from Finance's 15 query observers and
   Clipper's library collection. Preserve app event correlation and cleanup-failure
   boundaries. This small prerequisite gives the later access/resource split one
   common subscription lifetime without introducing a second selector.
2. Separate Finance's identity-bound controllers and access facts from its
   selected financial resource group. Keep current domain actor protocols and
   form behavior; extract existing source responsibilities rather than rewriting
   financial operations. Record which resources can stay mounted on same-workspace
   navigation. Review this boundary before behavior tests.
3. Bind the resulting Finance resource group to the existing DLF selector and
   shared drain composition. Remove the corresponding production scope/replacement
   decisions as they move. Qualify actual native worker selection, pending writes,
   access revocation and retained same-workspace forms. Retire the unused older
   attachment wrapper only after the production replacement is qualified.
4. Bind Clipper's library group to that same implementation. Replace the manual
   adoption/custody/replacement decisions in `application-readiness.ts`; supply
   schema-bound access observations and separate identity/workspace inputs to
   `createLibraryBinding`. Preserve web/extension convergence and explicit
   extension connection confirmation.

Each batch must list its exact source files and app-owned policy before editing.
Keep the shared engineering review/test gate; prior startup qualification does
not qualify these new lifetimes. No dependency, schema migration, data reset,
workspace UI or product wording change is needed for this design.

## Next source boundary: Finance workspace access observations

The first part of batch 2 changes three source files:

- `apps/finance/src/lib/machines/runtime/worker-query-observation.ts`: the thin
  Finance event/binding projection over DLF's qualified observation factory.
- `apps/finance/src/lib/machines/runtime/worker-workspace-access.ts`: the existing
  profile, directory, selected-workspace and membership subscription group, with
  an explicit correlated facts selector and its original read/disposal failures.
- `apps/finance/src/lib/machines/runtime/worker-queries.ts`: compose the access
  group and the remaining financial reads, preserving the current combined view.

Access facts remain app-owned native/schema observations, not shared role policy.
The access group has the caller's admitted binding/target as immutable input;
it owns subscription acquisition, current callbacks and disposal for that input.
Parent composition consumes its public facts, rejects foreign binding reports,
and retains the existing aggregate read-failure behavior. Unknown rows and cached
identity/directory facts keep their existing meanings. No directory absence or
root/bootstrap provenance becomes an access grant.

This first extraction preserves the current invocation lifetime. It exposes a
separate access owner so the later shared selection host can keep it alive outside
selected content resources without cloning queries or eligibility decisions.
It does not claim that access already outlives the content owner, nor does it
change route retention, native sessions or financial mutation/drain protocols.

## Required qualification

Retain the existing startup, offline-restoration, seed and extension checks. Add
the actual production selection path's tests for global routes, partial directory
replicas, same-workspace navigation, repeated/reordered selections, A → B → A,
access revocation, unanswered connections, later permission rejection, pending
local writes, native binding replacement and failed/unknown drain. Shared helper
tests alone cannot establish native resource or authorization correctness.
