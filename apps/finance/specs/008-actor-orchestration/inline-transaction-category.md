# Inline category creation during transaction editing

## Requirements

- Add a category action beside the category selector in the transaction editor.
- Reuse the category modal without a kind dropdown. Bind creation to the current
  transaction's kind in the integration, independent of submitted kind fields.
- Select the created category in the transaction draft after successful creation;
  closing or cancelling without creation preserves the existing selection.
- Preserve other draft fields. Persist the transaction only through its Save action.
- Retain existing category permissions, duplicate checks and local-first persistence.

## Plan and machine-first gate

Reuse the existing management scoped form and availability machine: open → validate
→ assess current authorization/duplicate policy → single local insert and settlement
→ success or existing invalid/blocked/failure outcomes. Existing scope replacement,
shutdown and issued-write draining remain owned by the scoped form. No new promise
actor or asynchronous orchestration is introduced. The write adapter performs the
existing createCategory leaf (pure schema validation, insert, local settlement).

The edit integration owns queries and the management controller. CategoryForm accepts
an optional fixed kind and exposes the existing modal opening action. The modal is
rendered outside the transaction form to avoid nested forms. TransactionForm receives
the successful category and selects it once the query supplies its option, emitting
input so existing draft comparison enables Save. All labels reuse shared messages.

## Review checklist

- [x] Implement focused changes in four presentation/integration files.
- [x] User implementation review.
- [x] After approval, inspect and update management unit coverage and
      tests/form-presentation.e2e.ts / tests/transaction-edit.e2e.ts for income and
      expense kind binding, automatic selection, draft preservation, cancellation,
      duplicate handling, permissions, save/reload and repeated creation.
- [x] Run relevant approved tests with disposable agent storage.

## Approved verification

Implementation approved for testing. All 52 session browser checks pass; the four
strengthened inline-category/sidebar scenarios also pass on a focused rerun. Income
and expense coverage verifies hidden-kind tampering cannot override the observed
transaction kind, repeated offline creation selects the new category, drafts survive,
cancellation writes nothing, duplicate names preserve selection, viewer creation is
disabled, category-only changes enable Save, and explicit saves survive reload.
Existing shared form and transaction-edit regressions pass. The 125 focused unit
checks include management duplicate/authorization policy and transaction entry.
Type checks, test-fixture types, formatting and whitespace checks pass. No production
fixes were needed. Browser storage was disposable in-memory Jazz on agent port 5182.
