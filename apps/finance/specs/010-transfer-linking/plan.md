# Implementation Plan: Link Internal Transfers

**Branch**: `feat/transfer-suggestions` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md)

## Summary

Implement internal transfers as a permission-protected relationship between an expense and income transaction. The transaction editor suggests exact same-currency opposite-side matches from another account within seven days; a separate paired-entry flow at `/transfers/new` creates both sides for manually maintained accounts in one user action. Same-currency creation uses one amount, while cross-currency creation requires a separately entered amount for each account currency and performs no conversion. Both flows persist two ordinary transaction rows and their relationship atomically, exclude linked entries from currency-separated workspace totals, and provide explicit unlink and deletion choices. The schema must retain each movement and all imported transaction provenance.

## Technical Context

**Language/Version**: TypeScript 6, Svelte 5
**Primary Dependencies**: SvelteKit 3, Jazz Tools 2.0.0-alpha.59, XState 5, Paraglide JS
**Storage**: Jazz local-first replicated workspace database; writes complete at local durability through mergeable transactions; Jazz policies enforce security and supported safety invariants, with app statecharts handling gaps and recovery
**Testing**: Vitest and Playwright; implementation tests remain behind the user's code review gate
**Target Platform**: Responsive browser/PWA with offline-capable local reads and writes
**Project Type**: SvelteKit web application
**Performance Goals**: Candidate suggestions are computed from the active workspace's locally available transactions without a network wait
**Constraints**: Same-currency integer minor-unit matching, no currency conversion, explicit per-side amounts for cross-currency paired creation, Jazz-enforced read/write/delete authorization, no `switch`/`case`, machine-first async workflows, localized text, additive migration (no data reset), small review batches, no tests before implementation review. Link, unlink, paired creation, and deletion complete at local durability; later Jazz rejection is a separately reported sync outcome. Concurrent offline safety conflicts require deterministic detection and repair.
**Scale/Scope**: Same-currency existing-transaction matching plus one-action paired creation in same or different currencies; one expense plus one income in different accounts of one workspace; seven calendar days for matching; linked entries remain in both account histories

## Constitution Check

- **Local-first and financial integrity**: Pass. Candidate matching uses replicated local records; links preserve both transaction rows and their account-specific amounts/currencies/dates.
- **Security and privacy**: Jazz remains the source of truth for read, insert, update, and delete permissions. Creating or removing a relationship requires edit access to both accounts. The relationship and counterpart details are readable only when both transactions are readable. UI checks never replace Jazz policies.
- **Safety and consistency**: Enforce compatible endpoints and marker-transition rules in Jazz where supported. Alpha.59 denies same-transaction unlink but accepts clear-then-delete when both writes are staged in order on one offline replica. If separate replicas sync deletion first, Jazz rejects it and does not retry after marker clearing. A disposable positive read-policy probe showed a pending unlink can be made visible by allowing both linked markers or both null markers; production must retain read permission on both endpoint relations and verify privacy. A multi-write local-first lifecycle needs sync-order and recovery states before production adoption. Negative correlated existence and unique-index approaches are unavailable in alpha.59. Two independent offline replicas also accepted competing marker assignments, so deterministic conflict detection and recovery remain necessary in app statecharts/domain logic.
- **Machine-first workflows**: Pass. The transaction-edit parent invokes the scoped form and supervises transfer search/selection plus the resource-owning link and unlink statecharts. Link, unlink, and linked deletion own reads, eligibility decisions, atomic staging, commit settlement, rollback, cancellation, and failure results; promise actors perform leaf operations only.
- **Integration ownership**: Pass. `TransactionEditEntry` owns Jazz subscriptions and actor binding. Presentation components receive data and callbacks.
- **Localization and presentation**: Pass. New text follows `.specify/memory/localization.md`; no decorative UI is introduced.
- **Migration and testing gates**: Pass. Add a migration from the current schema hash; do not reset data. Identify affected tests during review, then edit/run them only after approval.
- **Batch size**: Pass. Deliver schema/permissions, linking/matching UI, reporting, and lifecycle in separate focused review cycles of 4–6 implementation files.

## Design Decisions

1. Add an `internalTransfers` record containing the workspace and expense/income transaction references, plus immutable per-endpoint account, amount, and currency facts used by Jazz policy checks. Paired creation stages two ordinary transaction rows and this relationship atomically in one locally durable mergeable transaction. No third transaction is created and no existing transaction is rewritten to encode transfer status. Linking existing transactions supports same-currency equal-amount pairs only; paired creation may store different currencies and amounts because the user enters both sides.
2. Keep actual read/insert/update/delete permission enforcement in Jazz. Put safety constraints in Jazz wherever the installed version can enforce them: positive endpoint facts and a marker-transition guard, alongside dual-account authorization and privacy. The tested null-marker delete rule cannot authorize current atomic unlink. A two-write offline sequence works on one replica in order, but reversed sync from independent replicas is rejected without retry; interruption hides the orphan relationship. A multi-write lifecycle needs a positive read policy for its pending-unlink state, sync-order handling, and explicit recovery before adoption. App workflow checks provide preflight and recovery, not replacement security. Transfer reads must still require access to both endpoint accounts. The authority rejects negative correlated existence policies and has no unique-index declaration. Two-replica link probes showed conflicting updates can both be accepted, so app-level conflict detection and repair remain required. Revisit these gaps as Jazz improves.
3. Match exact `amountMinor` and currency, opposite kinds, different accounts, same organization, unlinked state, and dates within seven calendar days. Sort suggestions by absolute date distance, then date and stable transaction ID.
4. Implement link, paired creation, unlink, and paired deletion as statecharts that own local read/assess/stage/commit/rollback decisions. Their Jazz writes use mergeable transactions and wait only for local durability. Keep each pair mutation atomic locally. Serialize same-client safety-sensitive mutations through an explicit domain owner. After synchronization, detect conflicts from concurrent offline devices, produce a deterministic effective-link view that prevents double counting, and provide repair actions that still pass Jazz permissions. Do not hide multi-step workflow in an async helper or a `fromPromise` actor. A persistent sync observer reports late Jazz policy rejection and rollback separately from local completion.
5. Filter linked transactions from workspace expense totals and categorized totals while preserving account histories and balances. Do not infer transfer status from `paymentMethod`.
6. Deletion uses explicit choices. The existing account-grant model does not have a distinct delete capability; add an explicit account-level delete authorization and a way for administrators to manage it before exposing delete-both or unlink-and-delete actions. Do not reinterpret write access as delete access.

## Project Structure

### Documentation

```text
specs/010-transfer-linking/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── tasks.md
```

### Source Code

```text
src/lib/schema/transactions.ts
src/lib/schema/accounts.ts
src/lib/schema/identity.ts
src/lib/schema.ts
src/lib/permissions.ts
src/lib/domain/internal-transfer.ts
src/lib/domain/organization-permissions.ts
src/lib/machines/internal-transfer.ts
src/lib/machines/transaction-save.ts
src/lib/components/TransactionEditEntry.svelte
src/lib/components/InternalTransferEntry.svelte
src/lib/components/TransactionForm.svelte
src/lib/components/InternalTransferSuggestions.svelte
src/routes/transfers/new/+page.svelte
src/lib/components/TransactionDetails.svelte
src/lib/components/AccountList.svelte
src/routes/+page.svelte
src/routes/accounts/+page.svelte
src/lib/components/ExpenseOverview.svelte
src/lib/migrations/
messages/en.json
```

**Structure Decision**: Keep Jazz subscriptions, dependency binding, and parent actor lifecycle in `TransactionEditEntry`; use a transaction-edit parent machine to own the whole form workflow and compose scoped form/link/unlink child actors. The parent publishes a discriminated UI view and accepts typed user intents; presentational components render that view and call event callbacks without recomputing business readiness or duplicating lifecycle state. Child state stays private; finite results use invoke output and long-lived observations use typed reports. Keep local mutation serialization and sync rejection observation under explicit longer-lived integration/domain owners. Put pure match rules in the domain layer and keep transfer suggestions presentational. Keep reporting filtering beside the existing expense overview data flow. Extend existing permission/schema modules and add an additive migration without adding a new app layer.

## Implementation Review Slices

1. **Data model and migration**: relationship record and additive migration. Keep this to 4–6 files and review before policy or UI work.
2. **Policy and grant management**: link/privacy/dual-account authorization, explicit delete checks, and administrator controls for separate account delete grants. Review before building the transfer UI.
3. **Match and link**: pure candidate eligibility/order, editor query and transfer state, machine-first existing-link workflow, and localized selection UI. Review before paired creation.
4. **Paired entry**: a dedicated transfer entry route/integration and a machine-first mergeable workflow that stages the expense, income, and relationship together for local durability. Share only existing reusable form/domain pieces; review before reporting work.
5. **Totals**: linked-relationship observation and filtering from workspace expense and categorized totals. Review before lifecycle work.
6. **Lifecycle**: unlink, paired edit protection, and delete choices. Review each cohesive 4–6-file batch.

No tests are added or run in these slices until the user reviews and approves the implementation they cover. During each slice, inspect existing unit and Playwright coverage and report the affected files/scenarios for approval.

## Complexity Tracking

No constitution violations are planned. The new relationship table, one persistence statechart, and account-level delete capability each directly enforce approved transfer invariants and do not introduce a generic abstraction.

## Transfer list review cycle

Use `TransferView` as the Jazz integration boundary for workspace-scoped accounts, relationships, and transactions. Resolve effective reciprocal links with the existing domain helper and project readable pairs for presentation; this is a synchronous read projection without new actors, persistence, or workflows. `TransferList` composes the existing pure `TransactionList` through a row snippet, disabling daily totals. Render transfer rows with native list items and AppLink for query-preserving link semantics, keeping their content and amounts in TransferList. Keep posting dates and currencies independent. Add `/transfers` and update navigation. This focused cycle spans seven implementation files plus feature artifacts; tests remain behind implementation approval.

### Sidebar and saved-transfer refinement

Mount `TransferView` in `/transfers/+layout.svelte` and compose the existing pure `TransactionWorkspace` so index, creation, and detail routes share the sidebar. Keep Jazz subscriptions in that integration and derive the selected pair independently of account-filtered list rows. `SavedTransferForm` receives both rows and account data and renders prefilled disabled controls plus each transaction link. Preserve the existing unlink-before-financial-edit rule without adding a new persistence workflow. Carry the list page through row selection and mobile back navigation. This review cycle changes six implementation files; no actors or persistence helpers change.

Filter changes reset pagination through a replacing route navigation (`reset: false`), keeping focus/scroll and the selected transfer while updating the route URL read by pagination. A shallow URL update does not update that source in the installed SvelteKit version.

### Production route and CI verification

Match the existing transaction detail route option (`prerender = false`) on `/transfers/[id]` while retaining prerendered list/new shells. Include UUID transfer detail document navigations in the existing service-worker public-shell fallback; continue excluding non-document fetches, POST requests, malformed IDs, and unsupported paths. Extend the PWA cache assertion for the transfer index and cover a saved transfer after full browser/worker exit with HTTP cache cleared and the restarted browser offline. Verify production builds and browser suites in an isolated checkout with independent dependencies and generated files.

The same PR CI run exposed an existing account-order snapshot subscription gap after reload: observations can precede the ready sidebar's subscription. Keep actor ownership and its RESET/OBSERVE/MOVE protocol unchanged; select its current snapshot through `useSelector`, which reads the actor on subscription, so the sidebar's capabilities reflect observations already received. Existing account-order unit and browser suites cover ordering and scope replacement.
