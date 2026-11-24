# Shared workspaces across Delightful apps

**Created**: 2026-11-14

**Branch**: `feat/shared-workspace-initialization`

**Status**: Shared initialization/startup and production selection/leases adopted in both apps; remaining native acceptance and hosted qualification pending

Every Delightful app should have a workspace concept backed by reusable Local
First lifecycle behavior. Finance already exposes workspaces. Clipper will begin
with one private workspace created and selected automatically, without workspace
controls in the product UI.

## Architecture direction (2026-11-23)

The majority of workspace logic must be the same implementation in both apps.
Use Finance's existing workflow as the starting point: reuse what it already
consumes from Local First and move its remaining reusable orchestration into
Local First. Finance must consume each extraction too, so Clipper adopts the
same implementation rather than a parallel workflow with similar contracts.

App integrations should be thin bindings for schemas, storage permissions,
domain operations/resources and presentation. Hidden workspace controls in
Clipper are a presentation choice, not a reason for a separate lifecycle.
Initialization, selection, attachment replacement, invalidation and lifecycle
coordination belong in Local First. Domain resource cleanup stays app-owned,
with sequencing and settlement coordinated through the shared lifecycle.

Before implementation, inventory each Finance workspace responsibility as
already shared, to be extracted, or app-owned with a concrete domain reason.
Map Clipper's current equivalent to that inventory and identify the code to
delete. Every proposed app-specific workflow must explain why the shared
implementation cannot serve it through a small supported integration boundary.
Resolve common gaps, including offline bootstrap, in Local First for both apps.
Do not preserve Clipper's separate bootstrap merely to minimize its initial diff.

The [current implementation inventory](implementation-inventory.md) maps the
production owners on `origin/main` at `e7b8f5e7`, the shared ownership design and
the code to replace. It supersedes stale integration paths in the original
research, including the older Finance startup/selection attachment wrappers.

The [research and contract proposal](research.md) records baseline APIs, missing
contracts, ownership boundaries, risks and a proposed implementation sequence.
Remaining API details are design choices pending review. The user authorized
the seed/startup ownership extractions, canonical initializer adoption and their qualification in the current
session, as recorded in the implementation inventory. This specification alone
does not authorize publication or changes to production data.

## Required behavior

- Clipper opens a usable local library without signup or workspace setup. Its
  initial workspace is automatic and persists across restarts.
- Every Clipper content record belongs to the selected workspace's content root.
  Identity and workspace selection are separate integration responsibilities.
- Existing local workspace data remains usable offline. Missing remote evidence
  must not be interpreted as proof that another workspace should be created.
- Restoration and the explicitly authenticated extension resolve the same
  workspace for an identity. Web local initialization does not count as extension
  sign-in.
- Local First owns reusable initialization, selection, scoped leases,
  invalidation and lifecycle coordination. Both Finance and Clipper consume
  shared behavior rather than maintaining duplicate workflows.
- Finance's existing workspace workflow is the extraction baseline. Both apps
  consume the resulting Local First implementation; replaced app orchestration
  is removed as each extraction is adopted.
- Apps retain domain schemas, storage authorization, operations, routes and
  domain resource drains. Finance retains its financial and membership policies.
- Workspace isolation is enforced at storage boundaries. Hidden controls do not
  substitute for authorization.
- Scope changes invalidate new work immediately and drain admitted resources
  before replacement. Late results cannot affect a different activation.

## Acceptance scenarios

1. On fresh Clipper use, a private workspace becomes locally usable without a
   workspace prompt or remote connectivity requirement.
2. After locally acknowledged writes and a complete shutdown, offline reopening
   selects the same workspace and reads its available local content.
3. Restoring an existing identity with an incomplete local replica does not
   create a replacement workspace merely because local queries are empty.
4. Concurrent startup converges on the same intended initial workspace without
   conflicting bootstrap records or duplicate roots.
5. Account replacement or observed access loss invalidates the old lease;
   outstanding operations retain their original settlement and cleanup ownership.
6. Web and extension capture bind to the same resolved workspace, while the
   extension preserves its explicit sign-in requirement.
7. Finance preserves its exposed workspace selection and financial policies when
   adopting shared contract changes.
8. Backend checks reject unauthorized workspace access and cross-workspace child
   references, independently of UI state.
9. A responsibility inventory identifies the shared implementation used by both
   apps, the replaced code removed, and a domain reason for each remaining
   app-specific workspace behavior. Matching interfaces alone do not satisfy
   convergence while duplicate lifecycle implementations remain.

## Design work remaining

The [production selection integration design](selection-integration.md) records
the identity/access/resource boundary required by Finance's active worker before
both apps can consume the same selection and drain implementation.

- Extend canonical-root qualification to independent concurrent native replicas,
  unanswered connections, partial replicas and later permission rejection.
  Same-Db concurrent initialization, restoration and full offline restart are
  qualified in the implementation inventory. Device identity kind alone still
  does not prove that an identity was freshly created.
- Production workspace selection/access leases now use the same Local First
  resource owner in Finance and Clipper. Keep integrations thin and review
  remaining differences against the shared implementation requirement above.
- Confirm the effect of Clipper's accepted disposable development-data policy on
  the final schema plan. No data reset is authorized by this specification.
- Resolve whether cross-app workspace linking is desired. Shared lifecycle does
  not establish common cross-app membership or a single workspace database.

## Scope boundaries and related plans

Clipper workspace management UI, sharing, invitations and cross-app workspace
linking are not required for initial adoption. No new universal schema framework
or second backend is proposed. Runtime qualification follows implementation
review and must include native persistence and authorization, not only fakes.

- [Clipper application plan](../../apps/clipper/specs/001-jazz-clipper/plan.md)
- [Local First foundation](../../packages/local-first/specs/001-local-first-foundation/spec.md)
- [Local First current plan](../../packages/local-first/specs/003-verified-backup/plan.md)
- [Finance worker reuse and extraction](../../apps/finance/specs/013-local-first-startup/worker-foundation-reuse.md)

This cross-project feature has its own spec directory. Existing root and local
feature selectors continue to identify their current work; this documentation
change does not repoint or overwrite those selectors.
