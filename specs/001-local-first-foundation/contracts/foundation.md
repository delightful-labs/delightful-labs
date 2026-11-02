# Foundation Contract — Jazz-First MVP

**Status**: Current scope and implemented entry-point map. APIs remain pre-release. This supersedes
this file's earlier portable-schema and multi-backend proposal; Git history preserves that draft.
The [active specification](../spec.md) and capability-specific plans govern behavior.

## Package and Dependency Boundaries

V1 requires Jazz only. Deliver one package with explicit subpath exports, not independently installed
backend plugins or a runtime backend registry. Core contracts and workflows are SDK-independent;
Svelte integrations bind observations and lifecycle; DUI owns presentation primitives; named Jazz
adapters contain SDK calls. App-owned Jazz schemas and policies remain in identified integrations.
Future backend replacement may require new mappings and data migration. Source-compatible schema,
query, transaction, or permission portability is not promised.

A consumer adopts one capability at a time. It may retain its host session, existing schema and
unmigrated SDK integrations. The adopted boundary must have one lifecycle owner; a composition must
not start a competing client or close a host-owned session. Finance demonstrates this coexistence
without a full rewrite or schema migration.

## Implemented Public Entry Points

`package.json` is authoritative for exact exports and peer versions. These are available in built
package archives; this is not a claim of a published, stable npm release.

| Subpath                                                       | Responsibility                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `recovery`                                                    | Pure recovery phrase view and actor-free contracts                                  |
| `recovery/workflow`                                           | Reveal/hide workflow and selected view                                              |
| `recovery/messages`                                           | Owned message contract and English message factory                                  |
| `recovery/svelte`                                             | Optional recovery actor/view composition                                            |
| `backend/jazz/recovery`                                       | Capability over the host account handle                                             |
| `restoration/contracts`, `restoration/workflow`               | Explicit identity restoration lifetime and outcomes                                 |
| `backend/jazz/restoration`                                    | Host-session restoration capability                                                 |
| `session/contracts`, `session/workflow`                       | Acquisition, attachment, observation and issued retry ownership                     |
| `backend/jazz/session`, `backend/jazz/session-readiness`      | Jazz session acquisition and readiness adapters                                     |
| `workspace/contracts`, `workspace/workflow`                   | Host-observed selection leases, invalidation and exact drain acknowledgement        |
| `workspace/creation/contracts`, `workspace/creation/workflow` | Explicit-attempt transaction ownership, local persistence and interruption outcomes |

The `workspace` entry exports the pure WorkspaceSelector view and its typed message/view contract.
`workspace/presentation` exports createWorkspaceSelectorView and its actor-free input type. The
projection uses supplied local directory facts, supports a sole unselected choice and caller-localized
duplicate-name labels, and never grants workspace access. The view emits requests while retaining
the host-applied value until the host updates it. Missing observations remain distinct from an empty
directory. No client, actor, route, global theme, translation singleton, or remote freshness query is
created by presentation. Finance keeps its queries, existing labels and selection commands.

Recovery presentation has a single Close action, with no saved-phrase acknowledgement checkbox.
No subpath requires foundation-owned routes. Finance retains navigation, startup provenance,
workspace creation forms/journals, financial permissions, bank credentials, and domain write ownership.
Additional-workspace creation delegates its transaction lifetime to the shared creation workflow.

## Workspace Selection and Resource Ownership

A fixed binding identifies one acquired client/identity attachment. Selection requests and
observations carry fresh attempts/generations. Directory availability is independent of exact
locally known target access. An empty or failed directory cannot deny an otherwise allowed target.

Changing scope invalidates its lease immediately. The host retains issued writes and resource
owners until actual finite cleanup evidence arrives, then acknowledges the exact drain token/lease.
A closing notice or stopped actor is not proof that writes were cancelled or cleanup succeeded.
Known released failure and unresolved ownership are explicit outcomes. An unresolved drain cannot
silently authorize a replacement scope or another identity-changing SDK operation.

Finance supplies the bank/integrity and transfer drain join. Those financial resources and policies
are not library requirements. The library does not create workspaces, choose routes, or import
Finance's models as part of the selection boundary.

## Private Creation Transaction Ownership

The host prepares and journals one explicit attempt with stable operation, workspace and membership
IDs. Its named integration supplies mergeable transaction acquisition, local snapshot reads, pure
eligibility, unconditional staging, commit, local persistence and rollback. The shared statechart
owns their order and resource lifetime. No remote preflight, global wait, automatic selection,
routing, or bootstrap-from-absence is part of this operation.

Cancellation before commit rolls back after acquired operations settle. Once commit is issued,
interruption retains its eventual local settlement. An uncertain outcome preserves attempt identity
for host reconciliation before retry; successful rollback cannot certify that an uncertain commit
never happened. Later authority rejection is distinct from local persistence.

Finance supplies its organization, owner membership and starter-category bundle and retains its
journal/reconciliation schema. Its explicit additional-workspace flow adopts this capability without
changing automatic bootstrap or session startup. Focused full-policy and offline/cold browser tests
qualify that integration; the generic capability alone is not a storage authorization guarantee.
See [the creation plan and evidence](../workspaces/creation/plan.md).

## Remaining MVP Contracts

Shared creation presentation, naming, automatic first-workspace provenance, invitations and
authorized membership changes still require their own reviewed designs. Shared data access will be a modest typed boundary over concrete consumer
operations, not a portable schema descriptor or general query language. Reactive observations must
have explicit availability/error and disposal lifetimes. Operations must distinguish local
persistence, later rejection and unknown settlement; uncertainty must not trigger blind replay.

App-required local atomicity and authority-validated transactions remain separately supported
guarantees. Do not advertise unsupported storage protection or durability. Private/shared workspace
access must be enforced at Jazz's storage boundary, not just in presentation or a wrapper function.

## Qualification and Limits

Qualify the pinned Jazz/toolchain combination and each adopted capability with focused workflow,
backend, package-consumer and browser checks. Finance's focused adoption is extraction evidence,
not qualification of all future foundation contracts or every consumer deployment. Cold restart
requires retained storage and previously available application assets. Offline availability does
not establish fresh authorization or revoke data already disclosed.

A minimal independent consumer and the remaining workspace/data behavior are still MVP work.
A second backend, independent plugin packages, universal schema/query portability, automatic SSO,
and cross-app data sharing are deferred and are not v1 release prerequisites.
