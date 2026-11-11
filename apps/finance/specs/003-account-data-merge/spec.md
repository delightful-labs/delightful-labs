# Account connection with optional local-data merge

Status: proposed for review, 2026-10-16.

## User outcome

Before connecting another login identity by recovery phrase, a user with local finance data chooses Merge local data, Use connected account only, or Cancel. Merge adds a selected eligible source workspace's finance records to a selected eligible destination workspace without replacing destination records. Workspace eligibility and remaining conflict defaults require review; personal/business labels and initialization provenance do not establish eligibility.

## Requirements

- Show a source summary and explain duplicate handling and bank reconnection before switching identities. Empty seeded workspaces may use the existing connection flow. Same-identity connection is a no-op.
- Follow the equivalent-workspace model in `006-multiple-workspaces`: do not assume a unique personal home or use personal/business kind as authorization. Require explicit source/destination selection when multiple eligible workspaces exist. Exact eligibility, including jointly owned/shared workspaces and other members' records, remains unresolved; this update does not authorize importing them. Resolve eligibility before implementation.
- Capture and durably save a validated source snapshot before switching. Do not delete or modify source finance records. Retain recovery information across navigation/reload; never persist recovery phrases or bank credentials in the merge journal.
- Import accounts, categories, tags, transactions, independent Checks, transaction-tag links, and referenced batches/templates. Preserve money, currency, booked dates, notes, archives, relationships and bank transaction provenance. Keep the destination profile and memberships unchanged. Original Jazz audit fields cannot be copied; identify imported origin separately.
- Reuse destination system categories by kind. Preserve distinct user categories, tags, accounts and manual transactions even if labels, dates or amounts match. Recognize the same source records on retries and repeated merges.
- Deduplicate bank transactions using existing canonical provider external identity and destination organization. Never overwrite an existing transaction; report conflicting account mappings or values for review instead of silently discarding source differences.
- Do not migrate provider credentials or automatically connect, discover accounts, or fetch transactions. Report excluded connections and explain reconnection. Preserve provider provenance needed for later deduplication.
- Detect unsupported/unreadable related records, including attachments: block the affected import before writes and explain the issue; never claim a complete merge while omitting finance data.
- Show completed, partial, failed and cancelled results with counts and recovery actions. Local persistence and confirmed remote synchronization are distinct outcomes.
- After partial writes, cancellation preserves committed additions. Retry targets the same destination and snapshot and never overwrites later edits. Returning to the source requires an explicit action, not an unexpected session change.
- Use connected account only changes identity without importing; explain that local data will not appear in that account. Cancel before switching leaves the current session unchanged.

## Acceptance examples

1. Two identities with different ledgers become one selected eligible destination workspace containing both sets after Merge; destination records and the source remain intact.
2. Repeating the same import after interruption creates no duplicate records or broken references.
3. Same-looking manual transactions remain separate; identical provider identities are skipped or reported as conflicts.
4. Invalid phrase, offline target, permission denial, concurrent tab operation, reload and cancellation expose recoverable outcomes without false success.
5. Archived records and check/tag relations survive; unsupported attachments block rather than disappear.
6. Choosing remote-only or Cancel performs no import. Bank reconnection remains an explicit separate operation.

## Compatibility with approved future foundations

- Preserve independent Checks under `009-independent-checks`, including detached Checks and multiple compatible transaction references. Do not recreate the retired one-to-one check-details model.
- Preserve transaction descriptions and memos independently. Preserve future allocation identities and relationships through origin mapping, including amounts, categories, descriptions, and tags; allocations must sum exactly to their transaction total and share its kind and currency.
- Preserve original amounts and currencies without conversion or rescaling. Destination workspace default currency must not reinterpret imported accounts or transactions. Imported accounts retain their fixed currency.
- When attachment copying is supported, preserve attachment origin identity, transaction relationships, original filenames/types, and complete file contents under destination authorization. Until then, attachment-bearing graphs remain unsupported and must block before writes rather than be silently omitted.
- Preserve future internal-transfer pair relationships within the selected source graph, with both mapped sides in the destination workspace. Preserve per-side dates, currencies, amounts, and provider provenance. Missing, unsupported, or collision-affected counterparts must be reported before committing an invalid pair; exact recovery choices remain to be designed. Never infer internal transfers from matching amounts or ownership. Cross-workspace movements remain ordinary expense/income under the approved transfer rules.
- Stable destination identities may differ from source IDs; retain explicit origin mappings for transactions, allocations, attachments, Checks, and transfer relationships so retry/repeated import preserves logical identity and does not duplicate records.
- Archived-workspace write eligibility and incomplete-restore workspace eligibility must be resolved before import implementation. Preserve account/catalog archive state without treating archive flags as permission to bypass lifecycle restrictions.
- This login-identity merge is not a backup-to-existing-workspace importer. That future entry point may reuse mapping and conflict rules but requires its own approved input, eligibility, and complete-graph design. Transaction version-history preservation across merge also remains unresolved; importing current data must not be presented as preserving full source history.

**Compatibility acceptance expectations**: ordinary transaction IDs remain traceable by origin; retries do not duplicate related records; supported Checks, allocations, attachments, and transfer pairs retain their relationships and monetary invariants. Unsupported or unreadable related data blocks before writes. No requirement here ships deferred features or resolves the eligibility decisions above.
