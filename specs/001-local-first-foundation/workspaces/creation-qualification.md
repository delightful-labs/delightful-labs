# Private creation SDK qualification

Ten isolated cases pass against Jazz 2.0.0-alpha.59: four authority policy tests and six Chromium
exclusive-transaction/process-restart tests. See the [fixture README](../../../fixtures/private-creation/README.md)
for exact cases, commands and limits, and the [SDK mapping](jazz-creation-mapping.md) for source evidence.

The fixture qualifies an owner-only, immutable workspace/operation-marker record set. It checks
atomic insertion and invalid-reference rejection, foreign access denial and permitted orphan markers.
Browser cases cover exclusive confirmation, independent restored-account contention, termination
before commit and after confirmation, termination immediately after issuance without retaining a
transaction ID, and exact local read-back after process termination with the authority stopped.
The application shell remains served. The commit-gap race permits complete matching records or
complete absence; it does not force every transport schedule or authorize replay when records are absent.

## Ownership and scope

Jazz owns record persistence, synchronization, transaction semantics and write-settlement evidence.
The existing DLF creation workflows and journal are documented in [creation/plan.md](creation/plan.md).
This fixture adds no parallel journal, new package API, alternative creation owner or consumer migration.
Its exclusive checks do not change the shipped local-first creation policy.

The supplemental IndexedDB journal proposed earlier in PR #12 was removed following architectural
review: no unmet capability had been established against Jazz and DLF's existing journal. Its sixteen
adapter-specific tests and speculative workflow/contract documents were removed with it. They are not
part of this fixture's retained qualification results. Any future persistence proposal must first
establish the missing requirement and assess the existing Jazz/DLF capability.

## Remaining review work

These SDK fixtures do not qualify the existing DLF creation owner, reconciliation policy or journal.
Five separate review findings are tracked with acceptance criteria in the
[architecture review tasks](../tasks.md#architecture-review-follow-ups). Those tasks preserve unknown
settlement, correct abort evidence, consumer-owned schemas and explicit local durability contracts.
