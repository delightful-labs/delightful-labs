# Finance backup profile and adoption procedure

**Source inspected**: Finance `3eec71727d337a1845ea00ee61c5c9ad9d3e505c`, not a proven production revision. Initial SDK target: `jazz-tools@2.0.0-alpha.59`.

## Deployment evidence

Finance `specs/001-finance-mvp/status.md:122–130` records a replacement Jazz app, served bigint/independent-Check client, and successful historical structural catalogue comparison. This supersedes earlier retired-app findings. It does not establish the current frontend revision or schema/permission head. Current source has 23 tables; older validation notes described 19.

Read-only Netlify project lookup on 2026-11-03 returned `Authentication required`. No deployment metadata or private data was obtained. Before adoption, record the actual published frontend commit/assets and authenticated backend schema/permission hashes in a private verification record. Compare them with the explicit profile. Do not run `deploy:jazz`, a production build that publishes schema, or a dev server with auto-publication merely to inspect compatibility.

## Initial profile inventory

Profile ID proposal: `delightful.finance.workspace`, version 1. Each selected domain field requires an explicit allowlist and validator before the profile is implemented. This inventory is the scope to resolve against production, not permission to spread all rows into the archive.

| Source tables                                                                                      | Archive treatment                                                                                         | Restore treatment                                                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `organizations`                                                                                    | Workspace settings and source identity                                                                    | New organization ID and current owner; preserve settings; no existing workspace modification                             |
| `accounts`, `categories`, `tags`, `transactions`, `transactionTags`, `checks`, `internalTransfers` | All supported current and archived records and graph edges in workspace scope                             | Fresh mapped IDs; exact currencies/amounts/date-only values; policy-compatible transaction groups                        |
| `transactionBatches`, `batchTemplates`                                                             | Include present supported records, even where UI is not shipped                                           | Preserve fields and relations; fail if unsupported present content cannot be reconstructed                               |
| `transactionAttachments`, `files`, `fileParts`                                                     | Association records, metadata, ordered complete original byte contents                                    | Recreate mapped associations and file parts; compare full reassembled bytes                                              |
| `organizationMembers`, `accountMemberships`                                                        | Inert historical/reference information only                                                               | Create only the restoring user’s new owner access; no archived grants activated                                          |
| `profiles`                                                                                         | Minimal allowlisted collaborator identity provenance where needed; not entire profiles/avatars by default | Do not replace or impersonate user profiles; retain provenance inertly                                                   |
| `simplefinAccountLinks`, `simplefinSyncAttempts`, `simplefinSyncAccountResults`                    | Sanitized historical provenance with inert reference links                                                | Never recreate live bank links or attempts that require live credentials; retain in dedicated restore-provenance storage |
| `simplefinConnections`                                                                             | Explicit minimal nonsecret descriptive reference only                                                     | No live connections; reconnection required                                                                               |
| `uploads`                                                                                          | Exclude operational placeholder state; unfinished attachments prevent complete capture                    | Do not revive upload jobs                                                                                                |
| `checkDetails` / `transactions.checkDetailsId`                                                     | Legacy unsupported shape, detect visible references and check deployment schema                           | Reject unsupported coverage; do not silently omit or guess conversion                                                    |

There is no allocations table in inspected source. Future released allocations require a new supported profile version. Deleted records and full engine history are outside this current-data profile; archived records are included.

Credentials excluded even when encrypted: legacy bank `accessUrl`, credential IDs, salts, IVs, ciphertext, session material, login recovery phrases. Do not copy arbitrary provider messages or error payloads as provenance; allowlist safe enum/count/time fields. Exact source audit metadata is stored as source provenance; destination engine audit fields reflect the actual restoring user and restore time. Do not forge `$createdBy` or `$updatedBy`.

Current file permissions depend on valid transaction linkage. A client cannot establish that hidden orphan rows do not exist; legacy `checkDetails` is denied entirely. The promised scope is the complete supported application graph, not every hidden physical database row. Production schema compatibility and graph validation must make unsupported references visible or fail before a complete result.

## Source capture decision

Use an explicit single-user maintenance window for first adoption, without claiming automatic server snapshot isolation:

1. Confirm no other person is editing the workspace. Ask the user to close other tabs/devices and stop pending bank import/capture workflows before capture; explain this quiescence assumption in the interaction. Do not call it enforced cross-device locking.
2. The current app acquires a local write-admission lease and drains known mutation owners, attachments, and imports. A browser lock can coordinate cooperating current-version tabs but cannot control cached old clients or another device. If quiescence is unknown, stop.
3. Confirm remote owner membership and organization ownership consistency. Selected-account access and admin-only access do not satisfy owner-only backup. Revalidate authority at completion.
4. Read each required domain type using explicit `ReadTier.Remote`, no visible-screen filters, including archived records. Read relationships in all directions required by the profile and attachment contents. Use bounded, deterministic ordering. No implicit paging limit may truncate results.
5. Read the corresponding local-first graph and compare exact supported application values to detect pending/divergent local changes. Any difference causes an incomplete-source result; do not overwrite, discard, or silently back up only remote state. The procedure cannot discover edits retained only on an unconnected other device: those devices must be settled explicitly by the user.
6. Perform another complete remote graph read and compare exact values/references/bytes. Under the explicit no-writer assumption this detects accidental drift; two matching passes alone do not prove snapshot isolation and cannot exclude an ABA change.
7. Validate reference closure, unsupported legacy references, attachment part sequence/length and actual bytes, bounds, exact integer range, and source audit provenance. Freeze validated data in an owned immutable resource, then release the source lease.

This procedure requires qualification on the actual pinned SDK: remote read scope, policy filtering, attachment retrieval, local pending overlays and remote equality, limits, and failure outcomes. If quiescence and coverage cannot be established, export fails clearly. No disconnect, storage deletion, account replacement, or schema publication is part of capture. A future server snapshot may improve concurrency without being a prerequisite for the pure archive module.

## Restore decision

Do not use normal workspace creation unchanged: it makes membership visible and seeds default categories. Proposed Finance changes are additive and require a separate reviewed schema/policy design:

- Organization restore metadata: durable operation binding and `incomplete` / `complete` lifecycle. Existing organizations without restore metadata retain current behavior, subject to explicit cached-client compatibility verification.
- A private restore-operation journal, stable mapping/receipt storage, and inert source-provenance storage. None recreates credentials or previous membership grants.
- A distinct restore preparation path creates only the new organization and restoring owner access, without starter data. Its transaction IDs and allocated IDs are persisted before writes.
- Ordinary workspace selectors, direct routes, data-resource acquisition, background writers, and mutations all recognize restore state. Backend policies prevent ordinary editing/sharing while incomplete; owner-scoped restore writes must have a separately reviewed policy lane that enforces the operation binding. A UI-only marker is insufficient. Do not assume a caller-supplied flag can create a trusted backend context.
- The exact restore policy lane must be demonstrated using the alpha.59 policy compiler on a disposable app before destination implementation: validate allowed insertion/relation batches, allowed reconciliation reads, forbidden ordinary edits/invitations, ownership, and completion rules. If this cannot be expressed safely, redesign staging/activation explicitly; no permissive fallback is approved by this plan.
- Restore transactions group cyclic internal-transfer links and any enforced cross-record invariants together. Domain plan determines grouping; the generic engine must not blindly restore tables in dependency order and hope policies accept intermediate rows.
- Known IDs and archive-derived expected contents drive idempotency. Reconcile remote rows after uncertain outcomes. Matching existing content advances; authoritative absence may retry with the same IDs; differing/unknown results remain incomplete. Never overwrite conflicts or infer absence from a local-first result.
- Compare all domain records using reverse mapping of destination references and compare full attachment bytes; compare source provenance separately from newly generated audit fields. Confirm global settlement before completion. Activation is a distinct confirmed operation and is reconciled if its response is lost.

The policy-lane and pinned SDK behavior are implementation qualification work, not established capabilities. The shared archive and lifecycle contract can be implemented first. Do not begin real-data restore writes or claim restore readiness until the lane and isolation checks pass. No existing data is erased to make a test pass.

## Live adoption

Record the specific frontend/backend revision, selected workspace, profile support and aggregate size without publishing private contents. Export with the existing identity/storage setup, retain the file, reopen it independently, and restore to a new isolated destination. Reacquire the destination in a fresh app session and compare complete contents. Confirm original records unchanged and prior users/bank links not activated. Retain the original workspace and file when subsequent sign-in/storage work begins.
