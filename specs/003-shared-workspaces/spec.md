# Shared workspaces across Delightful apps

**Created**: 2026-11-14  
**Branch**: `spec/shared-workspaces`  
**Status**: Research and draft specification; implementation design pending

Every Delightful app should have a workspace concept backed by reusable Local
First lifecycle behavior. Finance already exposes workspaces. Clipper will begin
with one private workspace created and selected automatically, without workspace
controls in the product UI.

The [research and contract proposal](research.md) records current APIs, missing
contracts, ownership boundaries, risks and a proposed implementation sequence.
Proposed API details remain design choices pending review. This feature does not
authorize implementation, publication or changes to production data.

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

## Design work remaining

- Select safe offline bootstrap admission using supported installed SDK APIs.
  Current session readiness does not provide durable fresh-identity provenance.
- Generalize startup's Finance-shaped fields and expose initialized workspace
  provenance separately from selection/access readiness.
- Determine the smallest shared extraction beyond existing selection,
  transaction and creation APIs; evaluate Finance's selection attachment owner.
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
