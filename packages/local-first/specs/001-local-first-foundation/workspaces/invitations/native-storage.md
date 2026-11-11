# Native invitation storage and qualification boundary

## Ownership and scope

This is the next review task after the qualified generic redemption owner. Keep the native
schema in the host application: the library does not impose portable workspace tables, role enums,
or a migration on Finance. A disposable notebook application will qualify the exact native mapping
before documenting it as a usable recipe. It is not a second backend or a production schema export.

The ready backend session owns admission and the attributed exclusive transaction. Ordinary browser
startup, workspace selection, reads and saves never acquire this backend boundary. Redemption and
subsequent permission administration are explicit online operations. Do not change foreground read
or durability defaults to make this fixture pass.

## Native records

Use four tables with native UUID row identities and explicit relationships:

| Table               | Fields used by redemption                                                                                                                                 | Client boundary                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| notebooks           | name                                                                                                                                                      | Read only through current membership; creator may bootstrap                    |
| notebookMembers     | notebookId, accountId, role, invitationId (nullable)                                                                                                      | Own membership readable; no arbitrary self-grant or role mutation              |
| notebookInvitations | notebookId, codeDigest, role, expiresAt (nullable epoch milliseconds), revoked, consumedAccountId/consumedOperationId/consumedMembershipId (all nullable) | No client reads or writes in this qualification slice                          |
| notebookRedemptions | operationId, invitationId, notebookId, accountId, membershipId, acceptedAt                                                                                | No client reads or writes; status goes through authenticated server projection |

Private invitation and evidence rows have explicit never-read/insert/update/delete client policies.
Only backend-owned operations may issue, revoke, consume or record them in this slice. Public
invitation management is separate work. Never put the digest on the readable notebook or membership.
Roles come from the private invitation; the disposable app uses a fixed collaborator role and does
not claim that Finance's role/grant policy has been qualified.

A consumed invitation remains as a tombstone. All three consumed fields must be present together or
all absent; partial markers fail closed during native projection. Evidence is immutable and retains
its original membership identity after membership deletion. Operation IDs are scoped to the verified
account, not globally trusted client strings. Query all matching memberships/evidence and reject
multiplicity; do not use limit-one to conceal duplicates. Application-defined operation IDs must not
be passed directly to native UUID row IDs.

## Read mapping and the qualification gate

The current owner supplies a transaction, invitation ID, operation ID and verified account ID to
one read capability. Its requirement is a coherent authority observation, including trustworthy
absence. A native implementation cannot return `observed` merely because three promises resolved.

The proposed mapping reads the private invitation by ID, with its notebook relationship and the
notebook's memberships filtered to the verified account, plus authenticated evidence filtered by
account and operation ID. These queries must execute within the same exclusive transaction and
produce correlated notebook/invitation/account identities. A missing invitation maps to null;
a missing related notebook, malformed consumption, duplicate membership/evidence, or an evidence
record contradicting the invitation maps to unavailable or a fail-closed policy decision, never a
new grant. No raw native row or private digest crosses the client transport.

This proposal is deliberately gated on native qualification. Public SDK source in alpha.59 routes
Transaction.all through queryInternal with the same openTransactionId and deferred local updates,
and tracks pending reads before commit. That establishes API binding, not authority completeness,
snapshot coherence or phantom validation. The official invite recipe uses transactional reads and
exclusive confirmation, but does not qualify this richer query shape.

Finance's pinned-SDK retention investigation found a Remote query returning records outside an
exclusive transaction and none inside it. That reproduction concerns another query/runtime and must
not be generalized to prove either success or failure here. In particular, do not silently work
around it by reading outside the transaction and treating the result as the required snapshot.
If the candidate read cannot prove completeness and concurrency safety, it must remain unavailable.
A prepare/read/recheck protocol would change the owner contract and requires a separate statechart
review before implementation; it cannot be hidden inside the read leaf.

## Atomic staging

After the owner has decided eligibility, stage one unconditional batch on its existing transaction:
insert the prepared membership ID and invitation role, update the invitation with the three consumed
identities, and insert non-secret operation evidence with an independently generated native row ID.
No upsert, role replacement, new eligibility query, implicit retry or secondary transaction belongs
in this leaf. A synchronous staging exception may leave partial local staging; the existing owner
must roll back the transaction before reporting notStarted. Joined requires exclusive wait() with
no durability argument. Unknown outcomes use the existing retained-resource handoff.

## Qualification sequence after review

1. Publish the disposable schema/policies using public SDK test support. Establish accepted owner
   and member reads and unrelated identity denial. Prove invitation/digest/evidence denial and
   forged membership/role rejection independently of the server workflow.
2. Establish exact backend attributed transaction reads for existing and absent records. Seed from
   a separate session, update/revoke/remove from another session, and compare the selected query
   shapes inside the transaction with known authority state. Explicitly qualify empty results.
3. Run two separately attributed owners against the same single-use invitation. At most one new
   membership and one matching consumed marker/evidence may settle. Repeat for the same account
   with different operation IDs and the same operation ID; no duplicate grants or evidence.
4. Pause between observation and staging while another actor consumes, revokes, changes the role,
   or removes membership. Confirm conflict/rejection preserves atomicity; the stale owner must
   never report joined from local staging. Qualify phantom membership/evidence insertion too.
5. Verify replay, removal/replay denial, expiry equality, rollback, and unavailable authority.
   Then use actual bearer admission rather than stubbing withAttributionForRequest. Confirm
   verified write attribution and missing/malformed/expired bearer rejection.

These are acceptance criteria, not passing results. The existing 104 machine tests and 18 adapter
tests do not establish any of these native invitation-policy or concurrency properties. Keep the
endpoint/UI blocked until this boundary is qualified. Do not add implementation tests for the new
mapping before its implementation review under AGENTS.md.

## Sources

- Installed jazz-tools 2.0.0-alpha.59: dist/runtime/db.{js,d.ts}, Transaction.readAll,
  Transaction.commit, and beginExclusiveTransaction. No internal APIs will be imported.
- [Official invite-links recipe](https://jazz.tools/docs/recipes/access-control/invite-links):
  private invite rows, backend attribution and atomic exclusive redemption.
- Finance .specify/memory/jazz.md and specs/014-bank-sync-log/verification.md: the observed
  transaction-tier discrepancy and the requirement to distinguish local knowledge from authority.

## Schema implementation review

Implemented the disposable host schema and permissions in
`tests/fixtures/invitations/schema.ts`, outside the packaged library. The lint exception names
only that fixture, alongside the existing native consumer fixture; production SDK import
restrictions remain unchanged. All relationships use the public schema API. Historical membership
IDs in consumption/evidence deliberately remain scalar UUID values, rather than requiring a live
membership relation that could break removal/replay checks.

Notebook reads require current membership. Clients may create notebooks and bootstrap only their
own collaborator membership in a notebook they created, with no invitation attribution. This is an
explicit creator privilege: a creator can bootstrap again after leaving; invitees cannot use it.
Own membership rows are readable/deletable, updates are denied, and other membership inserts are
denied. Notebook update/delete and every client operation on invitations/evidence are denied.
Private writes and administrative removal in the forthcoming qualification use backend authority.

There are no async effects, queries, sessions or transaction workflows in this schema module.
Strict TypeScript and focused lint/format checks pass. No policy publication or implementation tests
have been added or run for this new schema before review. Next is native policy qualification for
this exact implementation; native read completeness and redemption concurrency remain unproven.

## Native permission qualification

After schema implementation review, the focused native policy suite passes 15 tests on
jazz-tools 2.0.0-alpha.59. The disposable authority publishes the exact schema/permissions. Creator
bootstrap settles globally; a backend-seeded member and the creator can read the notebook and only
their own membership. An unrelated identity sees neither. All three identities see no invitation
or redemption rows. Noncreator self-grants, creator grants to another account, forged invitation
attribution, membership updates and deletion of another member are rejected. Leaving settles
globally and the former member's subsequent Remote notebook query returns no rows.

For each identity, private inserts and deletes are rejected by serving-authority authorization.
Private updates are rejected synchronously by the SDK's read-policy guard because the target row
is unreadable; this is not independent evidence of the server update rule. The explicit never-update
policies remain in place. Assertions distinguish those boundaries rather than treating optimistic
local staging as acceptance. No production schema correction was needed.

Strict TypeScript, focused lint/format and diff checks pass. The test authority uses temporary
ports and disposable data; Finance's server and storage are untouched. These tests do not qualify
actual bearer admission, native redemption mapping, snapshot completeness, concurrency or browser
revocation/cache behavior. Next is the exact native transactional read mapping and its qualification.
