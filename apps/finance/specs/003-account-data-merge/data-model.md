# Merge data model

## Local-only snapshot and journal

Versioned snapshot: source identity/organization IDs, complete supported finance graph, source row IDs, validated values, referenced batch data and record counts. Exclude credentials and profiles/memberships. Store no separate createdOn/updatedOn timestamps; preserve user dates and original audit metadata only as provenance where needed.

Journal: operation ID, source and destination IDs when known, snapshot version, stable row mappings, per-record committed receipt references and typed failure details. Store facts needed to reconstruct progress; the machine owns live lifecycle states. Never resume into a different identity/organization implicitly. Retain payload after partial/failure; explicit discard explains that previously committed additions remain.

## Additive Jazz provenance

Proposed dedicated `mergeOrigins` table, finalized in the schema review: destination organizationId, source organizationId, source entity type, source recordId, destination recordId. Deterministic receipt ID from the complete origin tuple. Enforce destination admin authority and valid referenced destination records. Do not store source secrets or grants. Receipts persist after local snapshot cleanup and distinguish a prior import from an unrelated row-ID collision. Include supported original attribution metadata only if required for the reviewed UI, never forge Jazz audit fields.

## Mapping rules

- Organization: explicitly selected eligible source workspace → explicitly selected eligible destination workspace. Exact eligibility remains unresolved; no unique-personal-home or kind-based authority assumption.
- System categories: map by income/expense kind, independent of translated name.
- User categories/tags/accounts/batches/templates: stable imported IDs; no name-based unification. Restore archives after references.
- Transactions: preserve integer amount, kind, currency, bookedOn, description, memo, payment method, source/externalId and relationships. Manual IDs derive from full origin. SimpleFIN IDs use the existing provider formula. Existing records remain authoritative; differing source values or ledger mapping become visible conflicts.
- Independent Checks: map stable Check origins and account references, including detached Checks and multiple compatible transaction references. Preserve shared references; do not assume one-to-one assignment or import retired checkDetails storage.
- Transaction-tag links: remap both ends and use stable IDs.
- Attachments: detect and stop unsupported graphs before import. Future supported copying must map attachment identities and transaction relationships and preserve original filenames/types and complete contents under reviewed destination permissions. Placeholder file tables do not establish lossless copying support.
- Allocations (when supported): map allocation origins and transaction/category/tag references; preserve amount, optional description, and ordering when represented. Retain stable mappings across retries; enforce same kind/currency and exact transaction totals.
- Internal transfers (when supported): map the relationship and both transaction sides together; preserve source/destination accounts, per-side dates and currencies, and equal same-currency amounts. Provider collisions or missing counterparts require explicit pair-level assessment; never silently drop a side.
- Credentials/connections/memberships/profile: excluded with explicit connection reconnection notice. Preserve provider account identity as non-secret provenance for later reconnect decisions; do not create active links to absent connections.

## Invariants

All references stay within the destination organization. Currency and transaction kind match referenced account/category. No implicit authorization transfer, no unrelated destination overwrites. A committed target row and its origin receipt must be consistent atomically. A retry skips already imported origin even after the user edits the target. A canonical provider collision without matching provenance is existing/conflict, never replacement. Import conflicts result in partial completion until explicitly resolved; unsupported graph errors block before any writes.

Future formats must reject unsupported related graphs rather than omit them. Preserve original monetary values without conversion or rescaling. Archived/incomplete-restore workspace eligibility and full source-version-history preservation remain unresolved; current-value snapshots are not a promise of full history migration.
