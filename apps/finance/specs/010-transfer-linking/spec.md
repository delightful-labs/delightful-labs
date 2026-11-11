# Feature Specification: Link Internal Transfers

**Feature Branch**: `feat/transfer-suggestions`

**Created**: 2026-10-25

**Status**: Draft

**Input**: User description: "I want to work on the transfers feature. We already have some in the specs for basic decisions about this. Something that I noticed now that I am working with synced transactions, I have credit card payments that come from one account and then apply to another. It would be nice to do a search for the same amount from the other direction and show it as a suggested transaction (i.e. I want to convert an expense transaction to a transfer, it will show me income transactions within a reasonable time frame that I can connect to)."

This feature implements the approved transfer foundation in [001-finance-mvp](../001-finance-mvp/spec.md#approved-transfer-foundation-future-functionality), supporting both opposite-side suggestions for existing transactions and creating both sides in one user action. It does not introduce a third transaction kind. The legacy `transfer` payment-method value alone does not create a transfer relationship.

## User Scenarios & Testing

### User Story 1 - Find and link a matching movement (Priority: P1)

When a user edits an expense or income, they can mark it as an internal transfer and see eligible opposite-direction transactions that may be its other side. This makes synced credit-card payments and other movements between the user's accounts straightforward to reconcile.

**Why this priority**: Linking the two already-synced entries is the central user need and avoids creating duplicate movements.

**Independent Test**: Start with two unlinked, equal-amount, opposite-direction transactions in different accounts of the same workspace. Open one transaction, choose the other as its counterpart, and verify both retain their existing identities and details while becoming a linked transfer.

**Acceptance Scenarios**:

1. **Given** an unlinked expense and income of the same amount and currency in different accounts of the same workspace, dated within seven calendar days of each other, **When** the user starts linking either transaction as a transfer, **Then** the other is shown as a suggested counterpart.
2. **Given** multiple eligible counterpart transactions, **When** suggestions are shown, **Then** each candidate identifies its date, account, description when present, and amount, and the user can select one.
3. **Given** a selected compatible counterpart and edit access to both accounts, **When** the user confirms linking, **Then** the two existing transactions are linked without changing their IDs, source identities, amounts, dates, categories, descriptions, memos, tags, checks, or attachments.
4. **Given** an amount, currency, direction, date, account, workspace, or link-state mismatch, **When** candidates are calculated, **Then** that transaction is not suggested.
5. **Given** no eligible counterpart, **When** the user starts linking, **Then** the user is told there are no suggestions and can leave the transaction unlinked.
6. **Given** two devices attempt to link the same transaction to different counterparts while offline, **When** their changes synchronize, **Then** the app detects the safety conflict, never counts a transaction more than once, and gives the user a clear way to resolve it.
7. **Given** the Jazz authority is unavailable, **When** the user links two eligible transactions, **Then** the link is committed to the local database and reported as saved locally without waiting for network confirmation.

### User Story 2 - Record both sides together (Priority: P1)

When a user moves money between two accounts that are not represented by a matching pair of synced transactions, they can record the outgoing expense and incoming income together at `/transfers/new`. For same-currency accounts, one amount is recorded on both sides. For different-currency accounts, the user enters each side's amount independently. The app stores two ordinary account transactions and their relationship, and presents one completion result.

**Why this priority**: Transfers between manually maintained accounts need the same reporting and account-history behavior without requiring the user to enter each side separately.

**Independent Test**: Select two different accounts in one workspace and enter a transfer. For same-currency accounts, verify the shared amount is saved on both sides. For different-currency accounts, enter both amounts independently and verify each amount and account currency is preserved. Submit once and verify one expense, one income, and one relationship are persisted; both appear in their account histories and neither affects workspace income or expense totals.

**Acceptance Scenarios**:

1. **Given** two writable accounts in the same workspace with the same currency, **When** the user records a transfer and submits once, **Then** one expense and one income with equal amount and currency and a shared date are created and linked, and the user sees one completion result.
2. **Given** two writable accounts in the same workspace with different currencies, **When** the user records a transfer at `/transfers/new`, **Then** the form requires a separately entered amount for each account, creates one expense and one income with each account's currency and the shared date, links them, and performs no conversion or exchange-rate calculation.
3. **Given** the Jazz authority is unavailable, **When** the user submits, **Then** the pair is committed atomically to the local database and reported as saved locally without waiting for network confirmation.
4. **Given** Jazz later rejects the locally committed pair under its current permissions, **When** the rejection is synchronized, **Then** Jazz's rollback is reflected in the UI and the user receives an accurate recovery message.
5. **Given** the selected accounts are the same, in different workspaces, or not both writable, **When** the user submits, **Then** the operation is rejected and no transfer is created.
6. **Given** a transfer created together, **When** the user views account histories and workspace totals, **Then** both entries remain in their respective account histories and are excluded from workspace income and expense totals.

### User Story 3 - See correct totals for linked movements (Priority: P1)

Users see each side in its account history and balance, while workspace income and expense totals exclude both sides by default.

**Why this priority**: A link is only useful if it prevents internal movements from being counted as income or spending while retaining account-level history.

**Independent Test**: Link an expense and income and verify their account histories and balances include the movements while workspace totals, including categorized totals, exclude them. Unlink them and verify they return to ordinary income and expense totals.

**Acceptance Scenarios**:

1. **Given** a linked transfer, **When** the user views either account history or balance, **Then** that account's transaction remains present and affects its balance.
2. **Given** a linked transfer, **When** workspace income or expense totals are calculated, **Then** neither side contributes to totals by default, including categorized totals.
3. **Given** a linked transfer, **When** either side is unlinked, **Then** both transactions remain and contribute to their ordinary income or expense totals.

### User Story 4 - Safely manage a transfer link (Priority: P1)

Users can unlink a pair and can edit ordinary transaction details without accidentally breaking the pairing. Changes that make a pair incompatible are handled together or require explicit unlinking.

**Why this priority**: Transfer links must remain financially consistent as synced records change over time.

**Independent Test**: Link a pair, edit non-pairing details, then attempt an incompatible amount/account change and unlink the pair. Verify the link is preserved for compatible edits and cannot be left invalid.

**Acceptance Scenarios**:

1. **Given** a linked pair, **When** a user changes dates, descriptions, categories, or tags, **Then** the link remains.
2. **Given** a linked pair, **When** a user changes one side's amount, account, or currency so the pairing rules fail, **Then** the change cannot leave an invalid pair; the user must update both sides consistently or explicitly unlink.
3. **Given** a linked pair, **When** the user explicitly unlinks it, **Then** both entries remain as ordinary transactions and regain their normal total treatment.
4. **Given** a linked pair, **When** the user views either transaction, **Then** the user can open the other transaction from its detail page.
5. **Given** a linked transaction is deleted, **When** deletion choices are presented, **Then** the user can choose to delete both sides or unlink and delete only the selected side, and the effect on totals is explained before proceeding.
6. **Given** an account grant, **When** an administrator manages it, **Then** delete authority can be granted or revoked separately from read and write authority.

### Edge Cases

- Equal amounts with different currencies are not suggested; matching does not imply currency conversion. Cross-currency transfer records are created only through `/transfers/new` in this iteration.
- Equal same-currency amounts on the same account are not a transfer candidate.
- Transactions in another workspace are never suggested, even when their owner is the same person.
- Already linked transactions are not suggested as new counterparts.
- A candidate the user cannot read is never exposed; linking requires edit permission for both accounts.
- If access to either account changes before linking is saved, the relationship is not created.
- A locally committed link or unlink is complete for the user's offline workflow. Jazz remains responsible for enforcing security permissions when synchronized writes reach the authority; a later rejection and rollback is reported as a separate synchronization outcome.
- Mergeable writes from multiple offline devices may conflict on transfer safety invariants that Jazz cannot currently serialize. The app detects and resolves these as safety conflicts without weakening Jazz read, write, or delete permissions.
- A transfer fee remains a separate ordinary expense and is not linked as an unequal third movement.
- The existing `transfer` payment method without a counterpart link remains an ordinary transaction for reporting.
- Imported counterpart transactions retain their provider identity and are not duplicated.

## Requirements

### Functional Requirements

- **FR-001**: Users MUST be able to link two existing transactions in different accounts of the same workspace as one internal transfer: one expense and one income.
- **FR-001a**: Users MUST be able to create both sides of an internal transfer in one user action at `/transfers/new`. The system MUST persist one expense, one income, and their relationship in one locally atomic mergeable transaction; the UI MUST report one local completion result and MUST NOT report completion while only part of the pair is committed locally.
- **FR-001b**: For same-currency account pairs, `/transfers/new` MUST use one shared amount for both sides. For different-currency account pairs, it MUST require two independently entered amounts, validate each using that account currency's precision, and store each amount and currency on its corresponding transaction. It MUST NOT infer either amount from the other or from an exchange rate. Exchange rates and fees are not fields on this transfer action; fees remain separate expense transactions.
- **FR-002**: Linking existing transactions and suggesting matching counterparts MUST remain limited to same-currency transactions with equal amounts in minor units. Cross-currency linking of existing transactions remains deferred. Cross-currency pairs MAY be created only through `/transfers/new` under FR-001b; the app MUST NOT calculate a conversion.
- **FR-003**: Each linked side MUST retain its own business date, account currency, and account history entry.
- **FR-004**: When a user chooses to link a transaction, the system MUST suggest unlinked transactions in the same workspace that have the opposite direction, a different account, the same currency and amount, and a date no more than seven calendar days before or after the current transaction.
- **FR-005**: Suggestions MUST include only transactions readable by the user. Creating, changing, or removing a link MUST require edit permission for both accounts.
- **FR-006**: Linking MUST preserve both transaction IDs, provider source/external identity, and all existing transaction information and relationships; it MUST NOT create duplicate movements.
- **FR-007**: A linked transfer MUST remain visible in each account history and affect each account balance. Both sides MUST be excluded from workspace income and expense totals by default, including categorized totals.
- **FR-008**: Changes to dates, descriptions, categories, or tags MUST preserve a link. Amount, account, or currency changes MUST preserve the pairing rules; users MUST update both sides consistently or explicitly unlink.
- **FR-009**: Users MUST be able to unlink a pair while retaining both entries as ordinary transactions, which then count toward applicable totals.
- **FR-010**: Deleting a linked transaction MUST require an explicit choice to delete both sides, with delete permission for both, or unlink and delete only the selected side, with delete permission for that side. The effect on totals MUST be explained before proceeding.
- **FR-011**: A user who can read only one account MUST NOT learn details about a hidden counterpart through a transfer relationship.
- **FR-012**: A transaction's `transfer` payment-method value alone MUST NOT establish a link or change reporting totals.
- **FR-013**: Transactions across workspaces and movements to or from external accounts MUST remain ordinary income or expense entries.
- **FR-014**: Link, unlink, paired creation, and linked deletion MUST commit locally and complete without waiting for network access. Use a Jazz mergeable transaction and report local durability as the operation's completion boundary.
- **FR-015**: A linked transaction's detail page MUST provide a link to the other transaction's detail page when that counterpart is available.
- **FR-014a**: Jazz permissions MUST remain the security boundary for every read, insert, update, and delete. Local UI checks improve feedback but MUST NOT replace Jazz policies. If the authority later rejects a locally committed operation, the app MUST report that rollback as a separate synchronization outcome.
- **FR-014b**: The system MUST enforce transfer safety rules in Jazz wherever the deployed Jazz policy engine supports them, including compatible endpoints and reciprocal relationship facts; app state machines MUST validate before writes and detect or repair any conflicts Jazz cannot prevent. Concurrent offline conflicts MUST resolve display and reporting deterministically so no transaction is counted more than once, and repair MUST preserve Jazz permissions. Reassess app-side safety fallbacks as Jazz adds policy or uniqueness capabilities.
- **FR-015**: Administrators MUST be able to grant or revoke account-level delete authority separately from read and write access. Existing write access MUST NOT imply delete authority.

### Key Entities

- **Transaction**: An existing account movement with a direction, amount, currency, date, source, and user-entered details.
- **Internal transfer**: A relationship between one expense and one income in different accounts of the same workspace. The relationship does not replace or duplicate either transaction.
- **Suggested counterpart**: An unlinked, readable, opposite-direction transaction matching account, currency, amount, and date-window eligibility rules.
- **Account grant**: A user's account-specific access, including delete authority that is independent of write access.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For a transaction with one or more eligible opposite-side entries, users can see those suggestions while editing the transaction without manually searching unrelated workspaces or accounts.
- **SC-002**: Linking two eligible existing transactions changes no transaction IDs or movement amounts and creates no additional transaction entries.
- **SC-002a**: Recording a transfer between manually maintained accounts requires one user submission and produces exactly two account-history entries, one relationship, and one completion result.
- **SC-003**: All linked transfer sides are absent from default workspace income and expense totals, and both are present again after unlinking.
- **SC-004**: No user can create or change a transfer link without edit access to both involved accounts.

## Assumptions

- The initial matching window is seven calendar days on either side of the transaction date. This is a product default for the first implementation and can be revised after using the feature.
- Suggestions and linking of existing transactions in this iteration match the full amount and currency exactly. Cross-currency linking of existing transactions remains deferred; no automatic conversion is permitted.
- Link, unlink, paired creation, and linked deletion use local mergeable transactions so they remain useful offline. Jazz authority checks security permissions during synchronization; app state machines own safety validation, local conflict serialization, conflict detection, and repair feedback.
- Existing-transaction linking supports imported and manual records. Paired creation creates two ordinary manual transactions with one shared date and user-entered description, then links them as one transfer action. Same-currency accounts use one shared amount. Different-currency accounts require both amounts explicitly; the transactions retain their respective account currencies and no conversion is performed.
- Existing approved transfer requirements in `001-finance-mvp` remain authoritative for deletion, authorization, reporting, workspace boundaries, fees, and currency behavior.

### Transfer list (2026-10-31)

- `/transfers` lists each effective reciprocal expense/income pair once, using the existing transaction list layout, collapsible date groups, and 25-row pagination. Main navigation opens this list; its add action opens `/transfers/new`.
- Group pairs by the outgoing transaction's business date. Show source and destination accounts, both posting dates, descriptions without repeating identical descriptions, and independently formatted amounts for different currencies. Do not sum both sides into a daily total.
- Apply the active workspace and account filters. Selecting either endpoint account includes the pair; selecting no accounts shows the existing empty-selection feedback. Show no counterpart information unless both transactions and accounts are readable. Omit pending/conflicted relationships.
- Use the same desktop sidebar and mobile list/detail workspace as income and expenses, including on `/transfers/new`. Row selection opens `/transfers/[id]` with a prefilled saved-transfer form showing both sides and links to each transaction editor. Preserve the existing rule requiring unlinking before changes to linked financial fields; the saved-transfer fields are disabled. Shared visual components remain pure and receive data/snippets through props. Reuse existing messages without catalog changes.
- Transfer detail IDs are resolved in the browser and MUST NOT be prerendered as build-time entries. Production offline navigation to a UUID transfer detail uses the same public shell fallback as income and expense details, preserving its URL and loading saved values through Jazz.
