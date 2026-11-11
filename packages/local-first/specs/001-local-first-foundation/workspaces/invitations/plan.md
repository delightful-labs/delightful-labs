# Invitation redemption: first boundary

> Current status: client (33), adapter (18), owner (71), and native permission (15) tests pass.
> These qualify distinct boundaries, not end-to-end invitation redemption. See
> [native storage](native-storage.md) and [remaining tasks](../../tasks.md). Earlier review gates
> below record the sequence of implementation and qualification.

Branch `feat/workspace-invitations` begins at merged library main 0582a9a. Finance's extraction is
complete; this slice adds behavior that Finance has not implemented. No Finance migration is needed.

## Native evidence and limits

Installed Jazz 2.0.0-alpha.59 exports Classic invitation names only as removed-API diagnostics
(`dist/classic-api.d.ts`); do not use Group/useAcceptInvite/InviteListener. The current Jazz 2
[invite-link recipe](https://jazz.tools/docs/recipes/access-control/invite-links) uses a private code
record and an authenticated backend redemption route. Its exclusive transaction coordinates
membership with single-use consumption. This is a reference for the next adapter, not evidence
that our pinned SDK has passed invitation/expiry/concurrency qualification.

The proposed first interaction is explicit redemption of a single-use share link. A host owns
routing and transports the transient code in a URL fragment, never path/query/diagnostics. It removes
the fragment after capture. The library does not navigate, send email, create a server, or generate
an invitation code in this slice. Issuance, decline UX, expiry authority, revocation and member/role
administration need subsequent reviewed slices. Role names remain native app policy; no Finance
owner/admin/member/viewer policy is copied.

## Machine-first client model

A finite operation owns one caller-supplied stable operationId and scope. The host retains that ID
for authenticated reconciliation after an unknown result; it must not silently resubmit the code.
The scope contains the host's opaque identity/workspace/attachment correlation. The host forwards
INVALIDATE immediately on scope/access replacement and requests SHUTDOWN before stopping the actor.

State sequence: validating -> assessing -> redeeming (parallel control and request) -> resolving ->
terminal. Invalid IDs/empty codes never issue. Assessment is a pure local readiness verdict, not
remote discovery or permission enforcement. It can block unavailable identity/authority before any
call. Browser online status cannot establish authority reachability. Only an explicit invocation
of this operation performs the authenticated request; normal startup/read/save paths do not invoke it.

The request actor performs exactly one supplied redeem call. It must not hide backend read/check/
write orchestration. The future server adapter is a separate resource-owning statechart. Resolve
network exceptions to unknown settlement without retaining raw errors which may contain codes.
A structured authority reply is confirmed; a lost response is unknown, never failed-with-no-write.
Only the authenticated authority decides expiry, revocation, consumption and membership access.

Before issuing, cancellation, invalidation or shutdown terminates immediately with notStarted.
After invocation starts, interruption drains the request and retains its confirmed/unknown result;
it never claims rollback. Closing outranks scope invalidation, which outranks cancellation. Clear
the request/code and supplied capability from machine context on every terminal path. Public output
contains operationId, scope and settlement, never code or backend exception text. Do not attach a
raw actor inspector to this secret-bearing workflow. Raw actor.stop does not satisfy drain/cleanup.

## Ownership and following slices

The host owns its session/HTTP transport and any unavailable-server recovery UX. The library owns
finite interaction and truthful result semantics. A request identity is not caller authentication;
the backend derives identity from verified credentials, never a body-supplied user ID. No code is
persisted in a recovery journal. A later status endpoint must reconcile by authenticated operation
identity and return actual authority outcome before an explicit retry is offered.

Next: qualify pinned native backend request attribution and exclusive transactions, then implement
server authentication -> acquire -> read -> guarded decision -> stage membership/consume -> commit ->
settle -> rollback/cleanup. Use authority time for expiry and atomic single-use consumption; retain
sufficient non-secret redemption evidence for used/idempotent status. No application secret/server
credential goes in the client bundle. Storage policies must deny unrelated reads/writes independently
of UI controls. Actual authority results must not expose a protected workspace to an unrelated caller.

## Review and verification

First slice: public actor-free contract, finite client workflow, narrow package exports and this plan.
No schema/server/UI/catalog changes or implementation tests before review. Static checks are allowed.
After approval, add unit/public-consumer coverage for confirmed joins/already-member/refusals,
preissue blocking/validation, exception classification, interruption at each stage, priority,
secret/capability cleanup and absence of retries. Later real Jazz policy/server tests must prove
accepted/denied identities, replay, concurrent redemption, expiry/revocation and unknown settlement.
Cold offline/unanswered-server coverage must retain ordinary local usability alongside administration.

## Implementation review status

Implemented `workspace/invitations/contracts` and `workspace/invitations/workflow`. Confirmed
refusals are completed authority decisions, not successful membership grants; consumers inspect
the decision. Every terminal result assignment drops code/request and capability from context.
This is reference cleanup, not guaranteed memory erasure: hosts also release their input objects,
URL fragments and transport material. Issued work remains alive until its response/exception settles.
No transport timeout, retry loop or membership observation is treated as authority confirmation.

Recursive leaf inspection: assess executes one pure local verdict and sanitizes exceptions; redeem
executes one supplied authenticated request and converts exceptions to unknown settlement. No
queries, native transactions or secret-bearing error objects enter the result. The server graph
and pinned-SDK atomicity qualification remain the next task; invitation UX is not yet delivered.

Strict TypeScript, focused Oxlint/Oxfmt, declaration packaging and strict publint pass. At that first implementation review no tests were added or run. No localized/generated files
were changed. The subsequent user instruction to continue authorized the client qualification below.

## Client qualification

After implementation review, the user instructed continuation. All 32 focused redemption unit
tests pass: all seven authority decision variants; malformed IDs/code; both unavailable readiness
reasons; sanitized assessment failures; cancellation/invalidation/shutdown before issue and after
issue; confirmed and unknown settlement on interruption; every shutdown ordering and both
invalidation/cancellation orderings; no automatic replay; and unexpected request-child failure.
Terminal cases assert transient request/capability removal, child disposal, and absence of the
synthetic code from public context/output. No production-code correction was needed.

The built ESM consumer uses an unrelated notebook scope and consumes both public invitation
subpaths. Its redemption executes once, preserves authority membership confirmation and scope, and
drops transient resources. Public consumer types/execution, strict source TypeScript, focused
Oxlint/Oxfmt, declaration packaging and strict publint pass. Existing consumer examples execute
alongside the new fixture. No browser or native server tests are claimed: this slice contains no
view, transport, schema or backend redemption implementation.

Next task: design the pinned Jazz authority adapter and its transaction/resource statechart, then
review its implementation before testing authentication, expiry, single-use concurrency and storage
permissions. Ordinary local startup/read/save paths remain untouched by the client operation.
