# Feature Specification: Multiple Currency Entry

**Feature Branch**: `feat/multiple-currency-spec`
**Created**: 2026-10-27
**Status**: Complete
**Input**: Add a first multi-currency slice for USD and Tanzanian shillings, including account currency selection, currency-aware presentation, and dual-amount entry for cross-currency transfers created at `/transfers/new`.

This feature implements the approved currency foundation in [001-finance-mvp](../001-finance-mvp/spec.md#approved-multi-currency-foundation). It does not perform foreign exchange conversion. Matching and linking existing transactions remains same-currency only under [010-transfer-linking](../010-transfer-linking/spec.md).

## User Scenarios & Testing

### User Story 1 - Create accounts in supported currencies (Priority: P1)

When creating an account, a user can choose USD or Tanzanian shillings (TZS), with the active workspace's default currency preselected. The account keeps that currency for its lifetime once it has transactions.

**Independent Test**: Set a workspace default, create accounts using the default and the other supported currency, and verify each account and its transactions retain their selected currency. Change the workspace default and verify existing accounts and transactions are unchanged.

**Acceptance Scenarios**:

1. **Given** a workspace whose default currency is USD or TZS, **When** the user opens account creation, **Then** the default is preselected and the user can choose either supported currency.
2. **Given** an account is created with a selected currency, **When** the user records income or an expense for it, **Then** the transaction uses and retains that account's currency.
3. **Given** an account has transaction history, **When** its details are edited, **Then** its currency cannot be changed; the user must create another account to use a different currency.
4. **Given** an unsupported currency is submitted, **When** account or transaction input is validated, **Then** it is rejected with no write and no reinterpretation as USD or TZS.

### User Story 2 - Set a default currency for new accounts (Priority: P2)

An authorized workspace owner or administrator can change the workspace default between USD and TZS. The choice helps create new accounts without changing existing financial records.

**Independent Test**: Change the workspace default from USD to TZS, create an account and verify TZS is selected by default, then verify existing USD accounts and transactions are unchanged.

**Acceptance Scenarios**:

1. **Given** an authorized owner or administrator, **When** they edit workspace settings, **Then** they can select USD or TZS as the default currency.
2. **Given** the default currency changes, **When** a new account is created, **Then** the new default is preselected but the user can choose the other supported currency.
3. **Given** any existing account or transaction, **When** the workspace default changes, **Then** its currency and amount remain unchanged.
4. **Given** a member or viewer opens workspace settings, **When** they view the default currency, **Then** it is read-only according to existing workspace settings authorization.

### User Story 3 - Understand currency in account and transaction screens (Priority: P1)

Users can identify the currency when entering amounts and reviewing account details, while compact lists use localized currency symbols and keep totals separated by currency.

**Independent Test**: Create USD and TZS accounts and transactions. Review account creation, account details, transaction entry, account balances, transaction lists, and totals; verify form/detail currency codes, localized symbols, and separate totals.

**Acceptance Scenarios**:

1. **Given** an account or transaction form, **When** a currency affects an amount, **Then** the form identifies that currency by its ISO code and uses its ISO 4217 minor-unit precision.
2. **Given** account details, **When** the account is viewed, **Then** its ISO currency code is visible.
3. **Given** an amount in a compact account or transaction list, **When** it is displayed, **Then** it uses the active locale's currency symbol without an ISO code.
4. **Given** totals contain USD and TZS values, **When** totals are displayed, **Then** they remain grouped separately by currency and are not added or converted into one monetary amount.
5. **Given** any entered or displayed amount, **When** it is parsed or formatted, **Then** it respects that currency's ISO 4217 minor-unit precision, rejects excess entered precision without rounding, and preserves exact integer minor units within the supported safe-integer range.

### User Story 4 - Record a cross-currency transfer with both amounts (Priority: P1)

At `/transfers/new`, a user can transfer between accounts with different currencies by entering the amount leaving one account and the amount arriving in the other independently. The app records both movements and the transfer relationship without performing or implying a conversion.

**Independent Test**: Select a USD source account and TZS destination account, enter distinct amounts with valid precision, and submit once. Verify the expense and income retain their respective amounts and currencies, their account histories and balances reflect each side, and workspace totals remain separate and exclude both linked movements.

**Acceptance Scenarios**:

1. **Given** source and destination accounts in different currencies, **When** `/transfers/new` is opened, **Then** the form identifies each account and currency and provides a separate amount field for each side.
2. **Given** different-currency accounts, **When** the user enters only one amount or an amount with invalid precision, **Then** submission is blocked and no transfer rows or relationship are written.
3. **Given** valid amounts for both sides, **When** the user submits once, **Then** one expense and one income with their respective account currencies and amounts, and one relationship, are committed locally as a single transfer action.
4. **Given** the transfer is saved, **When** the user reviews the account histories and balances, **Then** each side appears using its own currency and affects its account balance.
5. **Given** the transfer is saved, **When** workspace income and expense totals are displayed, **Then** both sides are excluded from their respective totals, which remain separate by currency.
6. **Given** source and destination accounts use the same currency, **When** `/transfers/new` is used, **Then** the existing single shared-amount behavior is retained and the same amount and currency are saved on both sides.
7. **Given** the Jazz authority is unavailable, **When** a valid transfer is submitted, **Then** both transaction rows and the relationship commit locally together without waiting for network access.

## Requirements

### Functional Requirements

- **FR-001**: Manually created financial accounts and transactions MUST support exactly USD and TZS in this feature. Other ISO 4217 currencies MUST be rejected until explicitly added to the supported set.
- **FR-002**: Each account MUST have one fixed currency. Transactions MUST use their account's currency and retain it on the transaction. An account with transaction history MUST NOT have its currency changed.
- **FR-003**: Account creation MUST show a currency selector limited to USD and TZS, preselected to the active workspace default currency.
- **FR-004**: Authorized workspace owners and administrators MUST be able to change the workspace default currency between USD and TZS. The default MUST affect only newly created accounts and MUST NOT alter existing accounts, transactions, amounts, or historical records. Other roles MUST see it read-only.
- **FR-005**: Amount entry, validation, persistence, and display MUST use the selected currency's ISO 4217 minor-unit precision and exact integer minor units. Excess decimal places MUST be rejected rather than rounded; values outside the safe-integer range MUST be rejected.
- **FR-006**: SimpleFIN discovery and transaction imports MUST remain USD-only. Unsupported provider currency records MUST be explicitly omitted/rejected according to the existing import contract and MUST NOT be relabeled, converted, or written as USD.
- **FR-007**: Currency-bearing forms MUST display the ISO currency code for each amount and account choice where needed to disambiguate values. Account details MUST display the account's ISO currency code.
- **FR-008**: Compact account and transaction lists MUST display localized currency symbols without ISO codes. Totals MUST remain separated by currency; the app MUST NOT add amounts of different currencies or show converted totals.
- **FR-009**: When the accounts selected at `/transfers/new` use the same currency, the form MUST retain one shared amount for both transfer sides.
- **FR-010**: When the accounts selected at `/transfers/new` use different currencies, the form MUST require a separately entered, valid amount for each side. It MUST retain each value and account currency on the corresponding expense/income transaction and the transfer relationship. It MUST NOT infer either value from the other or perform any exchange-rate lookup or conversion. Exchange rates and fees are not recorded by this workflow; fees remain separate expense transactions.
- **FR-011**: Cross-currency transfer creation MUST remain limited to `/transfers/new`. Suggestions and linking of existing transactions MUST remain limited to same-currency, equal-amount pairs. Cross-currency matches MUST NOT be suggested or linked in this feature.
- **FR-012**: Existing stored amounts and currencies MUST remain unchanged when this feature is introduced; no currency conversion, rescaling, or reinterpretation is permitted.

## Assumptions

- USD and TZS are the only manually supported currencies for this initial feature slice. The supported set may expand through a later reviewed specification.
- SimpleFIN is limited to USD accounts and transactions because it supports American bank accounts; expanding provider imports is outside this feature.
- Currency formatting uses the active application locale. Compact lists use symbols only; account details and amount-entry forms show currency codes.
- There is no exchange-rate storage, conversion, converted reporting, or exchange-fee field in this feature.
- Same-currency paired transfer creation keeps the current single-amount interaction. Different-currency creation requires both values to be explicit.

## Out of Scope

- Foreign exchange rates, automatic or manual conversion, converted balances/reports, and currency revaluation.
- Cross-currency suggestions or linking of existing transactions.
- Currencies other than USD and TZS for manual account or transaction entry.
- Non-USD SimpleFIN account discovery or transaction import.
- Account currency changes after transaction history exists.
