# Workspace data model

## Jazz entities

- **Organization**: UUID, name, kind, defaultCurrency and ownerId. Names are trimmed/nonblank and may
  repeat. Existing personal/business enum values are storage compatibility values, not access or
  selection policy. `ownerId` is not the future multiple-owner set.
- **Organization member**: attempt-stable ID, organizationId, userId, profileId, owner role and all-account
  access for creation. Active membership/account scope remains necessary independently of URL selection.
- **Profile**: one existing login profile reused across additional workspaces. Creation never replaces
  its name/avatar. Optional `initialWorkspaceId` records initialization provenance, not a home workspace.
- **Category**: attempt-stable ID derived from workspace ID and stable seed kind/key; localized name,
  kind and isSystem. `src/lib/domain/workspace-defaults.ts` is the authoritative starter definition.
  Required and optional starters are seeded only on creation; later default edits do not rewrite or
  replenish existing catalogs. Workspace integrity does not check or repair categories.

## Initialization marker

First-use bootstrap writes profile, marker, organization, membership and categories in one local
transaction. Startup can accept a warm marker even when its original workspace is inaccessible.
Absent marker requires authoritative discovery; only no profiles/no accessible workspaces allows
bootstrap. Existing profiles without markers are unavailable, not backfilled or re-adopted. Losing
membership never authorizes recreation of a workspace or membership.

## Device-local creation journal

IndexedDB stores one pending slot keyed by app ID, server URL and authenticated user. Its frozen,
validated payload contains workspace/member/category IDs, the existing profile reference, name,
currency, kind, complete category seeds and identity/environment binding. It contains no transaction
input or provider credential. Lifecycle belongs in actor states, not a persisted phase flag.

The journal is written before Jazz creation. Atomic compare-and-write rejects a different competing
tab payload. Retry reloads the slot; Create another clears only the matching completed attempt and
permits a new ID. Reload reconciles without replaying writes. Retries retain original IDs/defaults.

## Reconciliation and atomicity

A single preflight checks profile, workspace, membership and categories. Matching records return the
existing workspace, absent records permit the same attempt, and inconsistent records yield conflict.
Reconciliation tolerates later display-name/category edits and optional-starter removal without
reseeding. Required creation records and authority relationships still have to match.

Transaction reads repeat atomic eligibility checks after acquisition; preflight is not a write lock.
One commit creates the complete new workspace, including the profile/marker only during bootstrap.
Stable IDs do not authorize blind inserts over existing records, imply global serialization, or prove
remote acceptance. Failed/unknown settlement never silently generates a replacement attempt.
