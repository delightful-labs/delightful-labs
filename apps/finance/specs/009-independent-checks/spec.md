# Independent check objects

Status: staged Check creation and exclusive-assignment deferral approved. Complete adoption code prepared as one user-authorized batch; implementation review and new tests pending.
Branch: `feat/independent-checks`.

## User outcome

A transaction refers to a check with its own stable identity. A user can create
that check inline when recording a transaction. Correcting the transaction’s
account or payment method does not require destroying or recreating the check.

The user confirmed both received and written checks. Income and expense use the
same check object and optional transaction reference; direction follows transaction
kind rather than a separate received/written discriminator on the check. The first
release keeps inline check controls on income only. The backend must permit an
expense to reference a check, but written-check visual controls are deferred.

The user approved optional paymentMethod for both income and expense. An attached
check requires paymentMethod `check`, and that method requires a check reference.
Other methods or an absent method carry no check reference. Keep current income
controls during adoption; do not introduce written-check controls in this slice.

## Proposed behavior for review

- A Check owns its check number/date and optional party, bank and check-memo data.
  Existing payer metadata remains supported; new payee fields/controls are deferred.
  Its ID is independent of the transaction ID. It belongs to a workspace.
- The transaction stores a check reference, not embedded check fields. One Save
  action first persists the Check, then saves the transaction referencing it.
  The interface treats this as one operation, with explicit partial failure handling.
  Cancellation before saving creates no Check; cancellation after the Check save
  may retain a detached Check.
- Preserve current number/date validation. Do not add amount, payee, clearance,
  deposit or void status requirements without a separate product decision.
- Exclusive check assignment is deferred. More than one transaction may reference
  the same Check ID. Do not add an assignment table, reciprocal assignment pointer,
  duplicate-reference policy or claim of global uniqueness. This does not detect
  separately created records representing the same physical check.
- Editing a check transaction may update check metadata. Switching away from
  Check detaches the reference and preserves the check record. Switching back
  within the same unsaved form restores that draft’s selection.
- Moving a transaction to another account MUST move its attached Check automatically,
  retaining the Check ID. Stage both account updates and transaction/tag changes in
  one SDK transaction; require write authority over old and new accounts. Do not
  move other transactions or enforce exclusive assignment in this release.
- Check entry is inline only. There is no existing-Check selector or Check catalog.
  Detached-record reuse controls are deferred. Do not match records automatically
  by check number, date, payer or amount.
- Detached checks retain an explicit account authorization scope. Workspace
  membership alone does not expose unrelated checks. Owners/admins and permitted
  account members can use the authorized set; viewers cannot mutate checks.
  No recipient obtains data from an account they cannot read merely by following
  a check reference. Account movement checks both old and new authority.
- Retain the saved Check ID if transaction persistence fails. Retry the transaction
  save using that Check rather than creating another one. Report full success only
  when the transaction is saved. Preserve explicit partial and uncertain-settlement
  outcomes; do not silently delete an independently saved Check as rollback.
- Offline local persistence remains separate from remote authority acceptance.
  Staged creation must preserve ordinary local-first saves; verify remote ordering
  and rejection behavior without requiring an authority round trip for every save.
- Imported transaction provenance remains immutable. The common payment/reference contract does not depend on provider source.
  Provider synchronization must retain the existing user-edit preservation rule;
  no automated check matching or provider-driven check association is introduced.

## Unchanged requirements

Money uses exact integer minor units; transaction amount/currency remain on the
transaction. Check separation does not create another ledger entry. Existing
transaction kind, permission, attribution, local-first, cancellation and submitted
write settlement requirements apply. No automatic bank fetching is introduced.

## Review decisions and exclusions

Received/written backend scope is confirmed; written-check visual controls are
deferred. Optional payment method for both kinds is approved. Do not add a new check-direction field or income/expense check tables. Keep detached records under their account permissions. Detached-record reuse controls remain deferred.
No existing alpha data is flushed and no schema is deployed in this design cycle.

## Approved simplification

The user approved deferring the one-transaction-per-Check restriction and creating
Checks before their transactions. This supersedes the earlier atomic creation and
check-assignment proposals. Canonical scope/payment compatibility remains required
for direct SDK writes. Written-check visual controls remain deferred.

## Adoption implementation awaiting review

Create/edit forms now use one direction-neutral contract, preserving provider
provenance and optional payment methods. Received-check controls support inline creation and editing the attached Check; there is no existing-Check selector. Switching methods
preserves Check field drafts without persisting a detached reference on a non-Check
transaction. Metadata edits preserve optional fields that are absent from the form.
Written-check creation controls remain deferred; existing expense references are
preserved when editing their ordinary transaction fields.

The coordinator settles Check creation/metadata changes before the atomic ledger/tag
write. It retains stable IDs and independently observed settlement in a memory-only
checkpoint scoped to the original binding, identity, organization, account, direction
and edited ID. A confirmed SDK rejection permits retry; an uncertain write is never
repeated based on an absent row. Recovery of an uncertain write verifies the prior
submitted row and exact tag assignments using an explicit remote read. This retry
may wait offline and can be cancelled; ordinary saves wait only for local persistence.
No automatic physical-check matching, deletion or remote-acceptance claim is added.

[013](../013-local-first-startup/spec.md), FR-007 and T012, requires recovery to preserve operation identity and recovery information across navigation/reload while leaving unrelated local work usable. The memory-only checkpoint above describes the historical implementation; durable recovery and its scoped states remain an investigation and design task. Narrow remote verification of an uncertain prior write remains valid; it must not become an ordinary-save or application-readiness prerequisite. This paragraph does not claim reload-safe recovery has been implemented or verified.

The user approved moving the attached Check automatically with its transaction, preserving identity and enforcing old/new account authority. Exclusive-assignment and shared-reference edge cases remain deferred. No data reset, physical schema cleanup or legacy
migration is executed. Production code no longer uses embedded check details; their
writes and references are denied. Old persistence actors have been removed.
