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

## Access/content lifetime split

The user's overnight instruction explicitly authorizes continued implementation
and tests for this PR. Keep scoped commits and native qualification; no new
review pause is needed between these already-authorized implementation/test slices.

The next batch changes `worker-queries.ts`, `worker-application.ts` and their
existing worker tests. The application ready state owns the access observer for
one native binding/target. Its nested reading state owns financial content
subscriptions. Same-workspace route changes reenter only reading; target or native
replacement reenters the access owner too. An independent access binding rejects
retired access reports while content read bindings continue to track route reads.

Financial read failure enters the nested read-failed state and releases content
subscriptions while retaining access observations. Access construction/read
failure withdraws financial content and remains observable as failed until an
explicit retry or replacement. Access and financial facts compose through a pure
app projection; no second subscription lifecycle or permission algorithm is added.
The existing forms owner remains identity-bound during this prerequisite. Its
actual financial drain split follows; this batch does not claim lease adoption.

## Identity controller extraction

After the observation lifetime split is qualified, extract the existing
startup/seed, profile-name/avatar, workspace-creation and navigation children into
`worker-identity-controls.ts`. `worker-forms.ts` retains the financial children
and composes the identity owner's public facts, forwarding existing typed
commands. Its existing combined public view remains the compatibility boundary
until the production application owns both groups independently.

The identity owner keeps one admitted native binding, current profile/navigation
facts and existing child reports. Its states are active, closing, failed and
closed. It forwards profile/directory/navigation observations while active;
startup provenance alone triggers optional seed admission. Shutdown sends each
existing child its supported drain command and waits for that child's actual
terminal result. Unresolved startup/seed settlement, unexpected completion or a
child crash fails the owner instead of reporting clean closure. Initialization
results reach the financial integrity owner through a public observation boundary.

Keep existing form schema validation, profile observation identity checks,
workspace-creation binding and navigation generations. This extraction does not
create new authorization policy, rewrite domain operations, or add a second SDK
owner. It prepares the same financial group for the existing DLF selector's lease
and drain contract while identity controls remain available independently.

## Shared selected-resource composition

The shared composition will invoke the existing DLF selection machine for one
fixed native attachment. It forwards scoped target/access intent and owns one
app-supplied resource actor for the selected lease. The app supplies the concrete
actor logic, a pure lease-to-input projection, a supported shutdown command,
a pure public-view projection and a pure classification of its terminal receipt.
Schemas, role policy, financial operations and library work remain in their apps.

Its states distinguish waiting, holding an admitted resource, invalidated/draining,
closing and unresolved release. A scope-invalidated report withdraws admission
before drain. The exact selector drain token is retained while shutdown is sent
once to the original resource. Only its successful terminal receipt acknowledges
that token. New selection/access observations can update the existing selector's
pending intent while the original resource drains; they cannot instantiate a
replacement early. Same-workspace route changes update the admitted app resource
without selecting a new workspace lease.

Unexpected resource completion/crash or an unresolved receipt cannot fabricate
release. Shutdown takes precedence over pending replacement, including during
construction and drain. The shared owner must retain the failed/original receipt
and return an unresolved outcome, preventing clean native close or another
resource acquisition. Public view reports carry the exact lease. App command
admission checks the current lease/target before targeting the concrete typed
resource actor; generic event registries or erased actor references are unnecessary.

Finance's extracted identity controller remains outside this composition. Its
financial controller and content observers become the app-supplied resource group.
Clipper supplies its existing library shutdown receipt and domain observations to
the same implementation. Production adoption must remove the corresponding manual
replacement/drain decisions in both apps rather than leaving competing owners.

## Financial controller resource group

Extract the current financial children and aggregate terminal receipt into
`worker-financial-controls.ts`. Native dependency types move to
`worker-form-dependencies.ts`; identity controls consume that type directly.
`worker-forms.ts` becomes a small composition of the identity and financial
owners, retaining its existing production input, command and public-view contract.
The financial owner consumes initialization as a typed fact; it never owns or
restarts identity startup/seed/profile/navigation resources.

Both owners receive current observations while active. Identity initialization
updates reach financial integrity through an explicit typed observation. Whole
native shutdown requests both groups once and waits for both terminal receipts.
An active group failing or completing unexpectedly fails the composition. Child
terminal snapshots during an expected close must not be reclassified as failures
before their terminal receipt is consumed. Commands carrying file/transfer
resources retain existing refusal/release behavior outside active ownership.

This grouping exposes the concrete financial resource for the shared workspace
owner. Its current compatibility composition will be removed from production
when the application adopts shared leases and keeps identity outside that owner.

## Production resource binding

Keep the native application owner and its existing ordered SDK shutdown. The
forms composition is the native-bound integration point for identity controls
outside the shared selected-resource owner. Replace its direct financial invoke
with that shared owner; do not add another target/drain algorithm in the app.
An app-owned workspace resource group combines financial content observations
with the exported financial controller. It owns their native shutdown receipts.

Move the application's financial query invocation under that resource group.
Publish correlated content facts back to the application for its existing pure
access/data/form projections; forward current observations back to the admitted
group. Financial read replacement remains subordinate to the workspace lease,
so same-workspace routing can retain financial forms and restart only relevant
reads. Access observations stay outside the selected group. Global identity
controls remain usable without any selected resource.

Derive selection evidence from existing Finance target-specific membership facts,
never directory absence or startup provenance. UI route revisions and content
read bindings remain distinct from native attachment, selection attempt and lease
epoch. Reject facts/views from retired leases before exposing them. Keep native
subscription disposal failure visible to both the resource owner (no replacement)
and the native host (no clean SDK close).

A domain resource can remain active in a failed state without a close receipt.
The shared owner must publish unresolved ownership and retain that invocation;
it must not wait for a dead actor, fabricate a terminal receipt or acquire a
replacement. A real terminal unresolved receipt is likewise retained and reported.
Only demonstrated release can acknowledge the selector's exact drain token.

## Explicit observation receipts

The next source slice extends DLF's existing native observation callback with an
opt-in `RELEASE` command and a typed released/unresolved receipt. Ordinary stop-only
consumers keep their current behavior. The native leaf withdraws callbacks before
calling the disposer, calls it once, and reports only after it returns. A thrown
acquisition/disposal cannot establish clean release. Actor stop remains fallback
cleanup and never publishes a successful receipt.

Finance's content query group supplies the eleven concrete source identities,
requests each release, and retains the invocation while collecting their actual
receipts. Its states distinguish reading, release after read failure, release for
shutdown, failed reads with demonstrated release, unresolved disposal and closed.
Shutdown overrides a read-failure drain. Foreign/duplicate receipts cannot satisfy
another source; missing receipts cannot establish closure. Existing access sources
remain independent and preserve their stop-only host-cleanup boundary. This is a
prerequisite to moving these queries inside the leased domain resource, not proof
of production lease adoption by itself.

## Finance production lease wiring details

The next batch changes the native `worker-forms.ts` composition, introduces
`worker-workspace-resources.ts`, moves the application's query invocation under
that group, and adjusts the existing typed native producer/contract/fixtures.
Identity controls and access observers retain their independent lifetimes.

A newly leased resource starts waiting for a correlated observation. Its input
is the immutable lease; it does not retain the first workspace's observations in
a fixed native-binding payload. The native composition supplies current forms,
initialization, network and read-scope facts through an admitted command. Only a
matching native binding and explicit workspace target may construct financial
controllers and content queries. This avoids both stale construction inputs on
replacement and an access/content circular dependency.

The resource group owns financial controllers above its content-read scope. A
same-workspace route change drains the old queries through their actual receipts,
then replaces only those queries, retaining the financial controllers and their
issued operations. Newer route facts replace pending read intent. Host shutdown
wins query replacement and waits for both real group receipts. Missing receipts,
query cleanup failure, financial failure or unexpected completion retain unresolved
custody and cannot start a replacement. Read failure with released subscriptions
remains a data failure, not loss of independently observed membership.

The composition forwards target/access intent to the existing shared selector;
it does not choose replacement itself. Target attempts and observation generations
remain separate from UI route revisions. Global routes suspend content selection
while profile/workspace creation/navigation remain live. Membership classification
is extracted from Finance's existing native predicate, rather than duplicated or
inferred from directory completeness.

Content publications include the admitted lease and read binding. The application
consumes only its current public forms lease, native binding, target and read scope,
with current allowed access evidence. Access invalidation clears admitted content
immediately. This also rejects late A reports after A → B → A or revocation/regrant
without confusing a route revision with a lease epoch. Publication compares exact
fact references to avoid an observation/view feedback loop. Resource commands with
owned file/transfer payloads use the shared owner's app-supplied refusal cleanup.

## Production admission and publication qualification

The production forms composition now invokes the shared DLF selected-resource
owner, with identity controls alongside it. The application no longer invokes
content queries directly. Access evidence stays native-bound and independent.
Finance's existing membership predicate is shared by navigation and lease mapping;
an explicit, locally permitted target does not wait for directory loading.
Unscoped default resolution still needs its catalog, and read/access failures
retain their existing failure boundary.

The native composition records the exact observation it has sent for each lease.
Comparing only child-reported observations amplified duplicate commands while
older child reports were still queued. The sent record is evidence of an issued
command, not a readiness flag; the shared owner still decides admission. Current
publications retain exact lease and read-binding checks. A loading forms report
can retain existing DOM only while its lease is unchanged. Revocation and a new
lease must withdraw old views. Identity startup feedback remains visible without
requiring any financial resource. Native cleanup failure takes precedence over
later failed group views.

Existing A → B → A tests now wait for actual replacement construction after the
old group's receipt. The held-write case asserts that neither B nor a new A can
construct early; after settlement, only the latest A may construct. New production
cases cover unknown access with live identity controls, local explicit content
before the directory answers, retained lease/controllers during route changes,
and revocation/regrant with held writes and rejected old lease/fact envelopes.

A remaining transport qualification must carry activation identity on delayed
UI/worker requests, in addition to the existing native lease envelope. Existing
UI session/selection revisions reject changed routes and identities, but a same-
route revocation/regrant can retain those revisions while changing the lease.
Do not claim end-to-end retired-command protection until those delayed request
origins are correlated with the current attachment and epoch. Keep identity-only
commands independent of financial admission and preserve owned-payload refusal.

## Delayed command activation identity

Finance's worker selection envelope will optionally carry a bounded activation
identity: a native forms-attachment revision and the shared selector's lease epoch.
The native root owns the monotonically increasing attachment revision, advancing
it only when it constructs a forms owner. This distinguishes reattachment even
when native binding, route revision and the new selector's initial epoch repeat.
The worker publishes these values from its actual admitted lease; incoming route
selection cannot choose the native activation. No SDK handles cross the transport.

Financial intent, private bank/backup/file admission and selected-content commands
must match that originating activation as well as existing session/route scope.
Missing or retired activation is refused before effects or secret/file preparation;
already-owned payloads retain their existing release paths. Identity/profile,
workspace creation, target selection and initialization retry keep their independent
identity-bound protocol. Same-workspace read changes retain the lease epoch;
revocation/regrant and native reattachment do not revive old packets.

The UI keeps the activation embedded in the view's immutable selection envelope
when constructing commands. It must not substitute the latest activation for an
old callback's supplied scope. Native transfer requests likewise retain their
originating lease, not merely the UI route generation, through request and drain
correlation. Tests must prove refusal after same-route revocation/regrant and
same-binding forms reattachment, accepted fresh commands, independent identity
controls, malformed packet refusal and exactly-once owned-payload release.


The public activation comparison is also used before Window-only URL filter
navigation, preserving the caller's supplied scope rather than reading a new one.
Transfer request identities use the framework's actor-session identity, so repeated
child names cannot reuse request/cancellation identifiers across invocations.
Native transfer scopes carry the exact lease supplied as immutable financial-owner
input. Root admission, the financial controller, request owner and drain matching
all retain that original lease; scope comparison has one app-owned pure helper.

A same-binding initialization retry retains its already observed local membership
while restarting the access source. The source's initial loading snapshot is not
new denial evidence. Actual absence or failure still withdraws that knowledge;
new native bindings and targets do not inherit it. This avoids constructing and
immediately draining an unnecessary first lease during controller reattachment.

## Clipper native access boundary

The native library builder now requires separate `identityId` and `workspaceId`
inputs. Its root, records and library capabilities use that explicit target;
the account producer supplies the identity ID as the canonical workspace by
current Clipper policy. Compatibility still requires the canonical ID, native
owner and bootstrap version. This does not add arbitrary-workspace creation.

The builder also supplies an ongoing local root-access subscription. Empty local
results remain unknown, native compatible rows allow access, incompatible rows
deny it, and native errors have a distinct callback. No bootstrap result, directory
completion or remote connection status produces that evidence. The native client
retains ownership; the caller owns the returned subscription disposer. This
boundary is qualified but not yet consumed by application readiness.

The next production composition must keep that observer and identity/startup
outside the DLF selected library owner. Before switching readiness to that owner,
the library must consume an explicit native collection-release receipt, as Finance
queries already do, rather than classifying completion before a stop-time disposer
runs. Clean domain drains and that receipt permit terminal release. Disposal
failure retains unresolved custody, blocks native client closure and cannot admit
a replacement. Shared-owner admission must disappear before the existing capture,
reader, image, search and write descendants receive shutdown. Their issued work
remains bound to the original resources until real settlement.
