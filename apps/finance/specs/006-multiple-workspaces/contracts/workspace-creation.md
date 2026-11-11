# Workspace creation and navigation contract

## Entry and result

The single `/settings/workspace` page combines choosing a workspace, editing the selected workspace name, and creating another workspace. The Settings sidebar contains one Workspaces link. Creation and rename remain separate operations. The only input is a trimmed nonblank name; duplicates are accepted. Eligibility requires the ready identity, matching existing profile, and live database/environment binding, independently of current workspace membership. No accounts or transactions are copied.

The application readiness tree owns creation across page navigation. The operation validates, freezes UUIDs and seed payload, and journals it in IndexedDB. Creation/retry invokes persistence, which validates the payload and runs one shared reconciliation pass before opening a Jazz transaction for an absent attempt. Loading a journal runs reconciliation without issuing writes. Promise actors perform leaf operations; transaction/resource owners handle cancellation, settlement, rollback and cleanup. Repeated submit while busy is ignored. Creation does not switch the active workspace. Success exposes an explicit Open workspace link and Create another action. While submitting, Close remains available; there is no extra Cancel button or visible preparation text. Persistent status/alert regions announce progress and results without remounting on success.

One journal slot per app/server/user records the frozen attempt before any Jazz write. Reload reconciles without replay. Retry reuses the original attempt; a competing-tab conflict reloads the slot without replacing it. Create another clears only the matching completed slot and allows new IDs. Journal failure blocks issuance. Matching completed records tolerate subsequent display-name/category edits and removal of optional starters, without overwriting them.

Feedback distinguishes locally saved, recovered, conflict, failed, unresolved, cancelled and closed outcomes; local settlement never claims remote acceptance. Identity replacement and shutdown drain issued work under its original binding before replacement. No creation/recovery action initiates provider requests.

## URLs and selection

Native SvelteKit page paths remain unchanged. Workspace context is the `workspace` query parameter: `/expenses?workspace=<uuid>`, `/expenses/new?workspace=<uuid>`, `/expenses/<id>?workspace=<uuid>`, `/settings/categories?workspace=<uuid>`, and `/settings/workspace?workspace=<uuid>`. The shared selector stays on `/settings/workspace` and selects the workspace whose settings are shown. Every sidebar link preserves workspace context, including identity pages. Account/Login remain identity operations. Once identity is ready, these pages and workspace management remain available during workspace-catalog loading or failure; ledger pages remain gated.

The URL is the sole selected-workspace persistence. Each tab, reload, direct link, and history entry keeps its own scope. No workspace prefix rewriting, custom route-directory mapping, synchronized selection or last-used workspace storage remains. The service worker matches cached public shells by native pathname, independent of query values; finance/auth requests remain uncached. Prerendered shells never read workspace queries on the server.

Generic query utilities read named values and update arbitrary parameters while preserving unrelated values and fragments. All app links use AppLink, which inherits the root-configured keys (currently workspace) for same-origin navigation. Explicit destination query values take precedence; per-link query props can override/remove values, and inheritParams can opt out or select other keys. External links and downloads do not automatically inherit context. Native anchors retain their browser behavior, attributes and accessibility; the existing pagination component uses the same resolver through PaginationLink. Domain scope parsing rejects duplicate, empty and malformed workspace values as explicit invalid scope; missing scope alone permits default selection. UUID presence never grants access. Workspace-specific helpers supply the parameter name and switching policy without duplicating URL serialization.

Unscoped overview/list/settings entry opens the sole accessible workspace or redirects to the chooser when ambiguous. A transaction detail without workspace context resolves its readable transaction’s workspace before navigation. Explicit invalid/inaccessible scope remains unavailable and never silently selects another ledger. Duplicate names include workspace IDs in selector labels.

Switching from a transaction detail or new-entry page opens the corresponding destination list and clears the record fragment and pagination. Other query parameters are preserved. Workspace-keyed presentation discards unfinished input immediately. Submitted writes remain bound to their original request. Account filters reset for changed workspace scope. Complete source/destination URLs invalidate stale lookups and navigation even when only the workspace query changed.

## Startup and integrity

Initialization provenance is distinct from selection. Warm startup accepts its marker without
requiring access to the original workspace. Without a marker, authoritative evidence is required:
no profiles/no workspaces permits bootstrap; an existing profile without a marker or a workspace
without a profile is unavailable. No legacy backfill, automatic replacement or lost-membership
repair is performed.

Selected-workspace integrity checks profile/membership consistency only. Suspected profile-link
repair requires authoritative evidence and current repair authority. Intact local workspaces remain
usable offline; attribution-only partial results remain finance-usable. Integrity does not query,
validate or repair categories. Required system categories remain creation data, and transaction
forms retain their normal scoped category/account validation. Retry is explicit.

## Deferred

Sharing, capabilities/role administration, invitations, multiple-owner administration, departure, archive and account merge remain outside this release. Existing policy roles are compatibility adapters, not the future capabilities design. Future work requires separate design and authorization; completion of create-and-switch does not implement those workflows.
