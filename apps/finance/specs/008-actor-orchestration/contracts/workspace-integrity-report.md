# Workspace integrity reporting contract

Status: local-first capability revision implemented and focused verification passed. Source contracts
are in `src/lib/workspace-integrity-contract.ts`; the resource owner is
`src/lib/machines/workspace-integrity-owner.ts`.

## Local-first capability boundary

[013](../../013-local-first-startup/spec.md), FR-004/006, makes attribution repair independent of
ordinary local usability. Integrity reports describe repair progress and settlement, not finance
or bank authorization. Readiness uses the current initialized session, selected workspace,
organization membership and credential-management role to accept explicit Sync Now commands. The
bank child retains credential readiness, passkey verification and per-operation authorization.
Repair completion, failure or retry alone neither grants nor revokes access and never initiates sync.
Missing/ambiguous repair inputs must not be treated as proof of current permission loss; actual
access observations invalidate capabilities through the separate readiness/bank owners.

## Requests and reports

Readiness sends `OBSERVED` with a request containing a monotonically increasing generation and an
optional binding: user, profile, organization, membership ID, role and account-access mode. A missing
binding means no eligible selected workspace. Database/environment is fixed for the actor attachment.
Reports target the typed recipient passed through input and contain the original request plus status.
Generation is a correlation token, not a persisted workspace ID.

| Status             | Payload                                                  | Repair presentation       |
| ------------------ | -------------------------------------------------------- | ------------------------- |
| waiting / checking | No extra payload                                         | Waiting / working         |
| complete           | Actual settlement                                        | Complete; no retry        |
| partial            | Profile-link issues, settlement, legacy `access: usable` | Partial notice and retry  |
| unavailable        | Actual settlement                                        | Failure notice and retry  |
| conflict           | Actual settlement                                        | Conflict notice and retry |
| failed             | Actual settlement                                        | Failure notice and retry  |
| unresolved         | Unresolved settlement                                    | Failure notice and retry  |
| closed             | Actual terminal settlement                               | Waiting presentation      |

The sole integrity issue is profile attribution. No blocked-partial variation or category repair
remains. The legacy partial `access` field is retained for contract compatibility; capability
decisions do not consume it. Reports carry no raw errors, transaction resources or private child
snapshots.

## Currency and invalidation

- Identity, profile, selection, authority-relevant binding changes or lost eligibility invalidate the
  accepted report and advance its request generation. Access owners independently invalidate
  affected capabilities before new actions can use superseded authorization.
- Equivalent integrity observations do not restart repairs. Explicit accepted retry advances the
  generation. Unrelated bank/account observations do not restart integrity.
- Loading/error recovery creates a fresh eligible request even if the IDs match an earlier visit.
  A → B → A cannot reuse the earlier A result.
- A draining operation retains its original request. It must never relabel completion with a newer
  generation. During replacement the owner retains only the latest pending request.
- Readiness accepts only a current matching request for repair progress/diagnostics. `selectWorkspaceIntegrityView` projects the public status for pure presentation.

## Lifecycle

The same repair child stays invoked across active/replacing/closing states. Old work drains before
replacement; cancellation/shutdown retain their priority over retries and late results. A failed
child cannot acknowledge another shutdown request. Its owner/supervisor handles unexpected crashes
separately from ordinary finite failure output.

Profile/membership assessment may confirm and repair an authorized profile link through a transaction.
Its read/reassessment/staging/commit/settlement and rollback paths retain resource ownership. Category
checking and automatic repair are excluded; missing attribution alone does not block finance.
