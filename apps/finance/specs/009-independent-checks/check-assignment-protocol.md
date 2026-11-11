> Historical research, superseded by the user-approved staged Check save and
> deferred exclusive assignment. The prototypes described below were removed;
> they are not the current implementation plan. See spec.md and plan.md.

# Check assignment protocol for review

Status: revised explicit-reference prototype implemented; runtime verification pending.

## Current records

| Record           | References and scope                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Check            | Independent ID, required checkAssignmentId, organizationId, accountId and existing metadata |
| Check assignment | Independent ID, required checkId, organizationId, accountId and nullable transactionId      |
| Transaction      | Optional checkId; method Check requires a reference and a reference requires method Check   |

The Check and assignment refer to each other through declared relationships.
Assignment identity is independent of both Check and transaction identity. Keep
that assignment through detachment and reuse, clearing transactionId when released.
No independently mutable status field or direction field is added.

Compose `assignedChecksSchema` with `checkAssignmentsSchema` for the revised
prototype. `checksSchema` remains the earlier isolated reference shape used by
publication regressions. Neither export is adopted in the root application yet.
The canonical persistence adapters are `appAssignedCheckSchema` and
`appCheckAssignmentSchema`; form input remains limited to Check metadata.

## Permission contract

Every predicate also needs account authorization. Enforce access to the old and
new accounts on updates and account-based read access while detached.

- Assignment insert requires a matching Check whose checkAssignmentId equals the
  assignment ID. If assigned, the transaction must point back to this Check with
  matching workspace/account and method Check.
- Assignment update additionally looks up the existing assignment with the same
  Check/workspace. It can retain its transaction, fill an empty assignment, or
  replace a transaction that explicitly has a null check reference. A missing
  former transaction is not a release. The latter condition uses the SDK's
  table-qualified `transactions.id` and `transactions.checkId` filters.
- Transaction insert/update with a Check reference requires a matching Check and
  an assignment with the same Check, transaction, workspace and account.
- Check update requires its existing workspace and assignment pointer to remain
  unchanged, and the assignment to point back with matching scope. This prevents
  a direct Check update from rotating the authoritative assignment pointer.
- Deny Check/assignment deletion. A transaction's null Check reference is a
  necessary deletion condition, but is not proof that no stale assignment points
  to it. Stranded-assignment behavior remains a required test and design gate.

The assignment helper supplies declarative predicates, not account access grants.
The isolated fixture must compose all of these duties before testing mutations.
No guarantee is inferred from TypeScript or successful expression construction.

## Mutation plans

| Operation       | Changes in one ordinary SDK transaction                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| Inline creation | Generate three IDs; insert Check, assignment and transaction with reciprocal references |
| Attach          | Set available assignment transactionId and transaction checkId/method                   |
| Metadata edit   | Update Check, preserving assignment pointer and owner                                   |
| Detach          | Clear transaction reference/change method and clear assignment transactionId            |
| Reuse           | Explicitly attach an available Check to another transaction                             |
| Account move    | Move Check, assignment and transaction scope together                                   |

These are plans, not new persistence effects. Existing create/edit workflow
ownership and the machine-first state sequence in plan.md still apply when this
contract is ready for adoption. This slice is entirely synchronous schema,
validation and permission expression construction; it adds no actors or resources.

## Authority verification after implementation review

First require policy publication and inline atomic creation with independent IDs.
Then exercise both transaction kinds, optional methods, duplicate references,
forged/duplicate assignments, immutable Check assignment pointers, missing/foreign
references, viewer/account grants, account moves, ordinary metadata edits,
release/reuse, same-batch transfers, upserts and restores. Verify rollback as well
as final remote records. In particular test detachment without assignment release
followed by transaction deletion: do not ship an unrecoverable assignment.

Use two separate authority sessions for competing ordinary transactions assigning
one available Check, inspect every surviving transaction reference, and distinguish
local acceptance from authority acceptance. Independent offline browser clients
remain a later required check if publication and authority behavior succeed.

Ordinary Jazz transactions are mergeable; the public SDK separately offers
exclusive transactions with serializable authority validation. A primary key,
reciprocal pointers or UI use of exclusive transactions alone does not establish
protection from direct ordinary SDK writes. Do not silently adopt server-only
saves, automatic retries or an exclusive transaction requirement.

If publication, atomic circular creation or authoritative reference consistency
fails, report the actual scenario before root adoption or another model revision.

## Findings from earlier candidates

The server rejects negative existence policies, despite exposing the corresponding
authoring expressions. The first assignment candidate also failed publication:
`JoinNotRefCompatible` for joining `checks.id` to `checkAssignments.id`. The
revised explicit relationships address that particular schema shape; their runtime
support remains unverified. The authoring compiler resolves qualified filters by
target table name, rather than relation property name, so use `transactions`,
not `transaction`, as the qualifier.

The previous focused run had 74 passing validation/publication-regression tests
and 11 skipped negative-existence behavior scenarios. Those counts do not verify
this revised prototype. No new runtime tests have been added or run for it yet.

## Revised prototype test result

The isolated fixture publishes only when Check-assignment updates are denied. With
that limitation, authority tests using trusted seeded rows confirm that a direct
second transaction reference is denied and an ordinary transaction metadata edit
succeeds. The direct atomic inline insert of Check, assignment and transaction is
rejected. Publishing the intended assignment-update predicate fails with
`OperandTypeMismatch`, so release/reuse is unavailable. These results make the
current candidate unsuitable for adoption; they do not establish two-client or
offline uniqueness. The current permissions fixture allows all users and validates
domain authority predicates only, not organization/account roles.

The focused run reports 78 passed and 11 skipped. The skipped cases exercise the
unsupported negative-existence prototype. Passing includes regression checks for
both prior publication failures, plus validation and transaction regressions.
No behavior tests establish successful inline creation or assignment release.
