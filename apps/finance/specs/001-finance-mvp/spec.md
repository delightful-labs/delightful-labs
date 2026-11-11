# Feature Specification: Delightful Finance MVP

**Feature Branch**: `001-finance-mvp`
**Created**: 2026-10-11
**Status**: Draft
**Input**: Migrate the finance tracking app plan into an implementable MVP specification.

**Current SimpleFIN authority**: The constitution and [002-manual-bank-sync](../002-manual-bank-sync/spec.md) supersede the original server-worker proposal. Setup, discovery, and synchronization are explicit client-initiated operations with passkey-protected credentials.

## Summary

Delightful Finance is a local-first personal finance tracker. A signed-in user can keep a personal organization, manage cash/bank/card accounts, record income and expenses, and organize transactions with categories and tags. The data model and permissions must support future business organizations, account-scoped sharing, SimpleFIN imports, attachments, and batch entry without requiring a tenancy redesign.

## User Scenarios & Testing

### User Story 1 — Start a finance workspace (P1)

As a user, I can sign in and receive an initial workspace on first initialization, so I can begin tracking finances without setup friction. All workspaces are equivalent; the first workspace is initialization provenance, not a permanent personal home. See `006-multiple-workspaces` for the approved multi-workspace behavior.

**Acceptance Scenarios**

1. **Given** authoritative first-use knowledge for an authenticated user, **When** the app initializes their finances, **Then** it atomically creates the initial profile, workspace, owner membership, starter categories, and initialization receipt. An empty local cache alone MUST NOT authorize creation.
2. **Given** an existing user, **When** they sign in again, **Then** an initialization receipt or accessible existing workspace is reused without creating a new personal home or replenishing optional starter categories. Access loss MUST NOT recreate membership; ambiguous legacy records require a recoverable unavailable outcome. Selection MUST NOT prefer personal/business kind or silently replace an unavailable selected workspace.
3. **Given** a user without access to an organization, **When** they request its data, **Then** Jazz permissions prevent that data from being read or modified.

### User Story 2 — Manage financial accounts (P1)

As a user, I can create, list, and archive USD cash, bank, or card accounts within my organization.

Account management uses the shared sidebar and existing account list/create forms. Account transaction history is reviewed in the income/expense views using account filters.

**Acceptance Scenarios**

1. **Given** an active organization, **When** I create an account with a name, **Then** it is associated with that organization and appears in its account list.
2. **Given** an account with transactions, **When** I archive it, **Then** it is hidden from new-entry choices while its historical transactions remain available in the income/expense views.
3. **Given** an offline session, **When** I create or archive an account, **Then** the local state updates immediately and synchronizes when online.

### User Story 3 — Record and review transactions (P1)

As a user, I can create and review income and expense transactions for an account with amount, date, category, description, memo, and tags.

**Acceptance Scenarios**

1. **Given** an active account, **When** I save an expense or income, **Then** the transaction stores a non-negative integer amount in minor units, currency copied from the account, organization and account references, a `bookedOn` calendar date stored as an ISO 8601 `YYYY-MM-DD` string, and a category matching its kind.
2. **Given** I record income paid by check, **When** I save it, **Then** check number and a valid check date are required and stored on an independent Check referenced by the transaction; other payment methods do not require those fields.
3. **Given** a transaction with no chosen category, **When** it is saved, **Then** it receives the organization's system Uncategorized category for that transaction kind.
4. **Given** I create a transaction while offline, **When** I save it, **Then** it is visible locally without waiting for a network response and later syncs.
5. **Given** an income or expense view, **When** I review transactions, **Then** entries are grouped by calendar date newest first, with daily totals reflecting selected account filters and kept separate by currency. Each entry shows category, tags, amount, and its description when present; account names are omitted from list items. The add-transaction action is a floating plus link at the bottom right, with a localized accessible name and the existing income/expense creation destination. Date groups use initially expanded Details disclosures with the date and daily totals in their summaries. Entries place category and tags above the description, with the amount and a single chevron navigation link on the right. Only the chevron is a link; its absolutely positioned pseudo-element expands the hit area across the row, and row text has no link underline.

### User Story 6 — Maintain a login profile (P2)

As a user, I can set a display name and add, replace, or remove an avatar for my login account, so workspace members can identify me.

**Acceptance Scenarios**

1. **Given** my login account, **When** I save a name or avatar, **Then** the profile belongs to my login identity and is reused across workspaces and devices.
2. **Given** another user's profile, **When** I attempt to change it, **Then** permissions reject the change.
3. **Given** transaction attribution, **When** an author has no name or avatar, **Then** a stable identity fallback is shown.
4. **Given** authorized workspace members, **When** they review attribution, **Then** they can resolve authors to display profiles without access to private credentials or unrelated workspace data.

### User Story 4 — Organize transactions with categories and tags (P2)

As a user, I can manage categories and tags and attach multiple tags to a transaction.

**Acceptance Scenarios**

1. **Given** an expense or income form, **When** I choose a category, **Then** only categories of the matching kind are offered.
2. **Given** a tag is archived, **When** I search/select tags for a new transaction, **Then** the archived tag is omitted while remaining visible on historical transactions.
3. **Given** the transaction tag picker supports creating a tag, **When** I save a transaction with a new tag, **Then** the tag is scoped to the current organization and transaction kind and inherits the transaction's selected category. Selecting an existing tag does not change that tag's category. Tags created separately in tag settings require an income/expense kind and may omit a category. Existing tags may only be selected when their kind matches the transaction.
4. **Given** category settings, **When** I review a category, **Then** I can see counts of its connected transactions and directly associated tags within my read permissions. Counts include retained history and archived tags and do not change with sidebar account filters.

### User Story 5 — Prepare for shared workspaces and imports (P3)

As the product evolves, organizations can support multiple roles, selective account access, and an optional organization-owned SimpleFIN connection without exposing provider credentials to ordinary members.

**Acceptance Scenarios**

1. **Given** an org owner/admin, **When** they access org accounts, **Then** they can access all accounts in that org.
2. **Given** a member/viewer in `all` account access mode, **When** they access the org, **Then** they can access all org accounts and related data.
3. **Given** a member/viewer in `selected` account access mode with no account grants, **When** they access the org, **Then** they have no account access.
4. **Given** a member/viewer in `selected` account access mode with account grants, **When** they access the org, **Then** they can access only granted accounts and related data; members may write only grants with write access, and viewers remain read-only.
5. **Given** a SimpleFIN connection, **When** an owner/admin reads connection settings, **Then** they can read its status; members/viewers cannot read its Access URL.
6. **Given** an authorized connection owner submits a setup token, **When** their device verifies passkey encryption/unlock compatibility and claims it, **Then** the token remains transient and the resulting Access URL is encrypted before persistence or replication. A stateless CORS relay may handle the request when required without retaining credentials. Setup MUST NOT fetch transactions; transaction fetching requires an explicit Sync now action and fresh passkey user verification.

## Product Requirements

See [MVP requirement classification](status.md) for verified-complete scope, outstanding verification, remaining MVP work, and deferred feature gates. Recorded focused results do not establish a fully verified deployed environment.

### MVP

- **FR-001**: The application MUST provide Jazz-backed sign-in and automatically create/reuse a personal organization for each first-time user.
- **FR-002**: The application MUST provide create, list, and archive flows for USD financial accounts scoped to the active organization, using the shared sidebar and existing account list/create forms. Account history is reviewed through the income/expense views.
- **FR-003**: The application MUST provide create/list flows for income and expense transactions on an account. New income and expense forms MUST default to the first checked active account in sidebar list order. When all accounts are checked, use the first account; when none are checked, require manual selection. All active accounts remain available for manual selection. Once the form is open, changes to defaults MUST preserve its current account and category selections.
- **FR-004**: Every transaction MUST have `amountMinor >= 0`, an ISO 4217 currency, `kind`, `accountId`, `organizationId`, `bookedOn` as an ISO 8601 `YYYY-MM-DD` calendar-date string, and a category matching its kind.
- **FR-005**: Income and expense transactions MAY omit their payment method. When present it is `cash`, `check`, `transfer`, or `electronic`. A Check payment MUST reference an independent Check with a nonblank check number and a valid check date; other or absent methods MUST have no Check reference. Received-check controls MUST permit inline creation and metadata edits, without an existing-Check selector. One Save persists the Check before atomically persisting the transaction and tag assignments. Partial and uncertain results retain stable IDs for retry. Moving a transaction moves its attached Check in the same SDK transaction while preserving the Check ID and requiring old/new account write access. Written-check creation controls remain deferred, while expense references use the same backend contract. See `009-independent-checks`.
- **FR-006**: Each organization MUST have non-deletable system Uncategorized categories for both expense and income.
- **FR-007**: Users MUST be able to create and archive org-scoped categories and tags; tags MUST support optional category association and many-to-many transaction assignment.
- **FR-008**: Archived accounts MUST be excluded from new transaction selection while historical data remains accessible. Archived tags MUST be excluded from new selection while retained on historical transactions.
- **FR-009**: The application MUST be usable offline for previously available data and local writes, with synchronization handled by Jazz when connectivity returns.
- **FR-010**: User-visible strings MUST use Paraglide message functions; initial supported locale is English.
- **FR-011**: The UI MUST use accessible native HTML controls, SvelteKit/Svelte 5, native CSS and CSS variables. Responsive-layout audit and comprehensive keyboard/focus review are deferred until after the post-MVP design revision.
- **FR-012**: Multi-step transaction compose and tag validation/save flows MUST be modeled with XState. Delightful UI TagInput provides tag search, selection, and removal interactions; simple UI state may use Svelte runes/stores.
- **FR-013**: The application MUST expose a lightweight organization switcher shell; creating/joining another organization may be deferred.
- **FR-022**: Workspace settings MUST let owners/admins rename the active workspace without changing its identity or associated accounts. The form MUST trim the submitted name, reject blank names, use local persistence, and remain read-only for members/viewers. Jazz permissions remain the authorization boundary.

- **FR-023**: Transaction attribution MUST expose its creator, most recent editor, and corresponding timestamps using Jazz's built-in `$createdBy`, `$createdAt`, `$updatedBy`, and `$updatedAt` metadata, without redundant application-owned audit columns. Edits MUST preserve creator attribution and update latest-editor attribution. A complete edit-history UI is not required.
- **FR-024**: Users MUST be able to set a display name and add, replace, or remove an optional avatar for their login account. Profiles MUST belong to login identities, be reused across workspaces, and be editable only by their owners. Authorized workspace members MUST be able to resolve transaction authors to display profiles, with usable fallbacks for missing profile details.

### MVP real-data readiness work

These items are required readiness work, not claims of completed implementation or verification. Deferred feature gates do not require shipping those features in MVP.

- **FR-056 — Verified data recovery**: MVP readiness for substantial real-data use MUST include an implemented and verified workspace backup/restore path following FR-042–047 for every data type supported by the released app. Verify that a backup restores into a new workspace with the same financial values and intact supported relationships while leaving existing workspaces untouched. Missing required records or file contents MUST prevent a complete-backup success claim. Future data types MUST extend this recovery path before being released. Login recovery alone MUST NOT be presented as an independent finance-data backup. Implementation review precedes adding/running recovery tests.
- **FR-057 — Currency support release boundary**: Until [multiple-currency feature 011](../011-multiple-currency/spec.md) is implemented and verified, manual entry and bank import MUST retain their current USD-only boundary. After that feature is released, manual account and transaction entry supports only USD and TZS; SimpleFIN imports remain USD-only. Unsupported currencies MUST NOT be silently parsed using two decimal places, converted, relabeled, or written as supported transactions. Existing stored currency and amount values MUST remain intact.
- **FR-058 — Sharing release gate**: Before enabling sharing, reconcile current fixed-role policies and single-owner storage with the approved `006-multiple-workspaces` scoped capabilities, selected-account privacy, independent deletion capability, and accepted multiple ownership. Align the constitution, affected requirements, schema/migrations, and enforced data permissions before implementing dependent sharing workflows. Verify direct-query privacy and authorization outcomes, not only UI visibility. Existing current-role behavior MUST NOT be presented as meeting the future sharing model. This gate does not require sharing UI or permission migration to ship in the owned-workspace MVP.

**Acceptance expectations**: recovery preserves supported finance values and relationships; unsupported-currency input/import produces an explicit unsupported outcome without incorrect writes; sharing stays deferred until its policy migration and focused authorization verification are complete.

### Schema and authorization readiness

- **FR-014**: The schema MUST include profiles, organizations, organizationMembers, accounts, categories, tags, transactions, transactionTags, checks, and accountMemberships. Retired checkDetails storage remains inaccessible until an explicitly authorized schema/data transition.
- **FR-015**: Authorization MUST implement the organization roles and explicit `accountAccessMode` rules in the constitution, including inherited access to associated transaction/tag data. Account grants MUST NOT grant access without active organization membership; viewer access MUST remain read-only.
- **FR-016**: The schema MUST include SimpleFIN connection/account-link records, transaction source and optional externalId, and organization-scoped owner/admin access to connection status and encrypted credential metadata. Usable credential access MUST additionally require the connecting user’s identity and passkey; administrative membership alone MUST NOT grant decryption access.
- **FR-017**: The schema MUST reserve attachment and batch records/relationships for later use; full attachment/batch UI is out of scope.
- **FR-018**: Jazz audit fields MUST be used rather than adding redundant createdOn/updatedOn columns. `bookedOn` is the user-assigned business date stored as a date-only string, separate from timestamps.
- **FR-019**: Every application feature and production code path MUST include appropriate automated unit tests and Playwright end-to-end tests. Tests MUST be added or updated with the feature implementation.
- **FR-020**: Unit tests MUST cover domain logic, money/date handling, validation, state machines, permission helpers/adapters, and relevant edge cases. Playwright MUST cover each primary user workflow, authorization behavior, and offline workflows where supported by the runtime.
- **FR-021**: A feature MUST NOT be considered complete until its relevant automated tests pass. New code requires coverage at the level appropriate to its behavior; tests need not be written to test test code or generated/vendor assets.

### Approved split-transaction foundation (future functionality)

These requirements record approved compatibility decisions, not shipped split functionality. Split entry, allocation storage, migration, and reporting changes are deferred. Existing MVP category/tag requirements describe the current single-allocation behavior until that implementation is separately planned and reviewed.

- **FR-025 — Movement and allocation**: A transaction MUST represent one movement in one financial account. It owns the account, organization, income/expense kind, currency, total amount, business date, overall description, memo, and transaction attachments. Its allocations describe how that total is categorized. Payment/check references and provider provenance remain transaction-level relationships.
- **FR-026 — Allocation contents and identity**: Each allocation MUST have its own stable identity, amount, category, optional description, and tags. Editing or reordering an allocation MUST preserve its identity. Allocations MUST inherit their transaction's kind and currency; all categories and tags MUST match that kind and organization. A transaction MUST NOT mix income and expense allocations.
- **FR-027 — Amount integrity**: Allocation amounts MUST be non-negative integer minor units and MUST sum exactly to the transaction total. An ordinary transaction MUST have one allocation for its full amount. A split MUST have at least two allocations, each greater than zero. Existing zero-value ordinary transactions MUST remain valid; a zero-value transaction cannot satisfy the split rules.
- **FR-028 — Remove split**: Converting a split into an ordinary transaction MUST require choosing the allocation to retain. Preserve that allocation's identity, category, optional description, and tags, and set its amount to the full transaction total. Preserve transaction-level details and relationships.
- **FR-029 — Compatibility and reporting**: Introducing allocations MUST preserve existing transaction IDs, totals, kinds, currencies, dates, descriptions, memos, provider provenance, check references, attachment relationships, and historical category/tag associations. Each existing transaction MUST become equivalent to one full-amount allocation, without guessing new classifications or duplicating money. Account totals MUST count the transaction movement once; category reports MUST count allocation amounts without also adding the parent total. Future backup/restore and merge designs MUST preserve allocation identities and relationships.

**Acceptance scenarios for the future implementation**:

1. A $100 expense split into $70 groceries and $30 household supplies contributes $100 to the account's expense total and $70/$30 to the respective category totals. Each allocation may have its own description and tags while the transaction retains its overall description, memo, and attachments.
2. Mixed income/expense allocations, amounts that do not sum to the total, zero-value split allocations, or fewer than two split allocations are rejected without persisting an invalid split.
3. Editing or reordering allocations retains their IDs. Removing the split after choosing the $70 allocation retains its ID, category, description, and tags, changes its amount to $100, and preserves transaction-level information.
4. Existing ordinary transactions, including zero-value entries, retain their identities, financial values, provenance, and relationships when allocation support is introduced. Their original category and tags describe the single allocation, and historical totals remain unchanged.

### Approved transfer foundation (future functionality)

These requirements record approved compatibility decisions. Transfer creation, linking, lifecycle controls, and reporting changes remain deferred; the existing `transfer` payment-method value alone MUST NOT establish a linked transfer or trigger reporting exclusions.

- **FR-030 — Linked movements**: An internal transfer MUST link two transactions in different financial accounts within the same workspace: one expense in the source account and one income in the destination account. Both MUST appear in their respective account histories and affect account balances. Their linked internal-transfer status MUST exclude them from workspace income/expense totals by default, including categorized income/expense reporting, without counting either movement twice.
- **FR-031 — Currency and dates**: Each side MUST retain its account's currency and its own business date; posting dates MAY differ. Same-currency transfers MUST have equal amounts. Different-currency transfers MUST require both amounts to be explicitly entered or supplied by the existing transactions being linked; the app MUST NOT calculate either amount from an online exchange rate. Transfer fees MUST remain separate expense transactions rather than unequal same-currency transfer amounts.
- **FR-032 — Existing entries**: Users MUST be able to create both sides together or link existing compatible expense/income transactions, including bank-imported entries. Linking MUST preserve transaction IDs, provider source/external identity, and existing transaction information and relationships, without creating duplicate movements.
- **FR-033 — Edit and unlink**: Changes to dates, descriptions, categories, or tags MUST preserve the link. Account, currency, or amount changes MUST preserve the pairing rules; otherwise users MUST update both sides together or explicitly unlink them. Unlinking MUST retain both transactions as ordinary expense/income entries, included in the applicable totals again.
- **FR-034 — Delete**: Deleting a linked transaction MUST require an explicit choice between deleting both sides, with permission to delete both, or unlinking and deleting only the selected side, with permission to delete that side. The latter MUST retain the counterpart as ordinary income/expense. The app MUST explain the effect on totals before proceeding.
- **FR-035 — Authorization and privacy**: Creating, linking, unlinking, or changing a transfer pairing MUST require edit permission for both accounts. Deletion MUST additionally require the separate delete permission for each transaction being deleted. Access to only one account MUST NOT disclose details of the hidden counterpart through the transfer relationship; the accessible account's transaction remains visible under its ordinary permissions. These are future capability requirements, not a claim that current role policies already implement separate deletion authorization.
- **FR-036 — Workspace boundary**: Movements across workspaces MUST remain ordinary expense in the source workspace and income in the destination workspace, included in each workspace's totals even when the same person owns both accounts. Cross-workspace linking is deferred and MUST NOT be inferred from matching ownership or amounts. A movement to or from an account outside the app MUST be recordable as ordinary expense/income without requiring a counterpart.

**Acceptance scenarios for the future implementation**:

1. A $500 transfer between checking and savings in one workspace appears as a $500 expense and $500 income in the respective account histories. Balances reflect both movements, while workspace income/expense totals exclude them by default.
2. A transfer between different currencies retains both explicitly supplied amounts and each account's currency. Different posting dates are accepted; unequal same-currency amounts are rejected as a pair, with fees recorded separately.
3. Linking existing imported entries preserves both IDs and provider provenance without adding transactions. Unlinking retains both entries and restores their inclusion in income/expense totals.
4. An invalid one-sided amount/account/currency edit cannot leave an incompatible pair. Deletion presents the approved choices and their reporting effects; deleting only one side retains the unlinked counterpart.
5. A person lacking edit permission for either account cannot change the pairing. A person who can read only one account can still read its transaction without receiving hidden-counterpart details; delete permission is checked separately for each deleted entry.
6. Moving money between two workspaces owned by the same person remains expense/income in the respective workspace totals. An external-account movement can be recorded with no counterpart in the app.

### Approved multi-currency foundation

These requirements record approved compatibility decisions. [Feature 011](../011-multiple-currency/spec.md) defines the first implementation slice and its supported currency set. Until it ships, the existing USD-only release boundary above remains in force.

- **FR-037 — Account currency**: Each financial account MUST have exactly one currency. Every transaction MUST use its account's currency and retain that currency on the transaction. Once an account has transactions, its currency MUST NOT be changed; users needing a different currency MUST create another account rather than reinterpret historical amounts.
- **FR-038 — Separate totals**: Totals MUST remain separate by currency. For example, USD 500 and TZS 200 MUST NOT be added into a single monetary total. The approved internal-transfer reporting exclusions still apply within these currency-separated totals. Converted reporting is a separate future feature requiring explicit exchange-rate rules.
- **FR-039 — Workspace default**: A workspace's default currency MUST prefill new financial accounts. Changing that default MUST NOT change existing account or transaction currencies, convert amounts, or reinterpret historical data.
- **FR-040 — Currency precision**: Amount entry, validation, import, and display MUST respect the currency's ISO 4217 minor-unit precision rather than assume two decimal places. Entry MUST reject excess decimal places rather than silently round. Stored amounts MUST remain exact integer minor units within the supported safe-integer range. Introducing currency-aware behavior MUST preserve existing stored amounts and currencies without rescaling or reinterpreting them; incompatible legacy records require explicit review rather than silent correction.
- **FR-041 — Cross-currency transfer entry**: When users create a transfer between accounts with different currencies, the `/transfers/new` workflow MUST require a separately entered amount for each side and retain each account's currency. It MUST NOT calculate either amount from an exchange rate or otherwise infer one from the other. Linking or matching existing transactions across currencies remains deferred; existing-transaction matching MUST remain same-currency.

**Acceptance scenarios for the future implementation**:

1. An account with transaction history cannot have its currency changed. Existing transactions retain their original account currency and amounts when multi-currency support is introduced.
2. A workspace with USD 500 and TZS 200 reports those totals separately, with no implied conversion or combined monetary total.
3. Changing a workspace default from USD to TZS prefills TZS for a new account while leaving existing USD accounts and transactions unchanged.
4. JPY 100, USD 1.23, and KWD 1.234 correspond to integer minor-unit amounts of 100, 123, and 1234. Entries with excess decimal places are rejected without rounding; stored values survive display and editing without precision loss.
5. A cross-currency transfer created at `/transfers/new` preserves both separately supplied amounts and their account currencies. No conversion or exchange-rate estimate is performed automatically. Existing-transaction matching does not suggest cross-currency candidates.

### Approved backup and restore foundation (future functionality)

These requirements record approved backup/restore behavior. FR-056 now requires a verified recovery path for released MVP data types; support for future data types remains deferred until those types ship.

- **FR-042 — Complete workspace backup**: A backup MUST represent one complete workspace's finance data, including accounts, transactions, categories, tags, Checks, attachments and their contents, archived records, and future allocations, batches/templates, and internal-transfer links when present. It MUST preserve amounts, currencies, provenance, and relationships in a versioned format that supports future compatibility handling. Login recovery phrases and bank credentials MUST NOT be included; bank integrations require reconnection after restore.
- **FR-043 — Backup authority and completeness**: Creating a complete-workspace backup MUST require owner permission and access to all included data. Selected-account access MUST NOT authorize an export labeled a complete workspace backup. All required records and attachment contents MUST be verified available before backup success is reported; unavailable data MUST prevent a complete-backup success claim.
- **FR-044 — Optional encryption**: Users MUST be able to choose a password-encrypted backup or an unencrypted backup file. Restoring an encrypted backup MUST require its password independently of application login. Backup encryption MUST NOT depend on including login or bank credentials in the file.
- **FR-045 — Restore isolation and authority**: Restore MUST create a new workspace without changing existing workspaces. The restoring user MUST become the new workspace's owner. Previous memberships, invitations, and access grants MUST remain reference information only and MUST NOT reactivate access; sharing requires explicit setup again. Importing backup data into an existing workspace is a separate future merge operation requiring conflict handling.
- **FR-046 — Validate before writes**: Restore MUST validate the entire backup before writing restored data, including supported format version, readable attachment contents, valid amounts, and intact relationships. Invalid or unsupported backups MUST be rejected with an explanation, leaving existing workspaces untouched.
- **FR-047 — Interrupted restoration**: If restoration is interrupted after writes begin, the new workspace MUST remain explicitly marked restore incomplete and unavailable for ordinary finance use until restoration finishes. Retrying the same restore MUST resume without duplicating records or relationships. The app MUST NOT report incomplete restoration as successful.

**Acceptance scenarios for the future implementation**:

1. An authorized owner exports a complete workspace including archived records and attachment contents. Missing required data prevents a complete-backup success result; selected-account access alone cannot authorize the operation.
2. Both encrypted and unencrypted backups can be selected. An encrypted backup requires its password to restore, and neither form contains login recovery phrases or bank credentials.
3. A valid backup restores into a new workspace owned by the restoring user, preserving financial values and relationships without modifying existing workspaces or granting access to previous collaborators. Bank access requires reconnection.
4. An unsupported format, unreadable attachment, invalid amount, or broken relationship is rejected before restored-data writes begin.
5. An interrupted restore remains visibly incomplete and outside ordinary finance use. Retrying resumes the same restoration without duplicate records; only completed restoration makes the workspace available for ordinary use.

### Approved transaction attachment foundation (future functionality)

These requirements record approved compatibility decisions. The first implementation is limited to image attachments; other file types and visible upload/synchronization status remain deferred. Existing placeholder tables do not establish implemented attachment support.

- **FR-048 — Scope and access**: Attachments MUST belong to the whole transaction, including transactions with multiple allocations. Attachment read access MUST follow the transaction's account permissions; adding or removing attachments MUST require transaction-edit permission. Account sharing MUST include attachments on historical transactions within the recipient's authorized access, without granting access to unrelated files.
- **FR-049 — Multiple files**: A transaction MUST support multiple attachments, including images, PDFs, and other files. Each attachment MUST retain its filename and file type. Adding a file and removing an existing attachment MUST be separate actions; no replacement workflow is required. The initial release supports JPEG, PNG, and WebP images, with a maximum of 10 MiB per selected image and five images per transaction. Images larger than 2048 pixels on either edge MUST be resized proportionally before storage; the stored representation preserves the selected image type and filename. Download returns the stored representation.
- **FR-050 — Offline and synchronization**: Users MUST be able to add attachments offline and synchronize them later. Previously downloaded file contents MUST remain available offline; attachments whose contents are not available locally MUST indicate that downloading is required. Pending or failed attachment uploads MUST NOT prevent saving the transaction. The app MUST clearly distinguish attachments that are not fully synchronized from completed synchronization and MUST NOT claim unavailable file contents are available offline. Visible synchronization status and download-on-demand for remote-only content are deferred from the initial image-only release; the initial UI MUST NOT claim that an attachment has synchronized or is available offline when that fact is not observable.
- **FR-051 — Removal and cleanup**: Removing an attachment MUST leave the transaction intact. Deleting a transaction MUST remove its attachments from ordinary access, subject to the eventual transaction deletion/undo policy. Physical file cleanup MUST preserve files still referenced elsewhere and MUST respect future retention and recovery rules; this foundation does not decide a retention period or promise immediate physical erasure.
- **FR-052 — Stable identity**: Each attachment MUST have a stable identity preserved through synchronization, backup, restore, and merging. The identity MUST distinguish attachments independently of filenames or matching contents; future backup/restore and merge implementations MUST preserve attachment relationships without silently omitting files.

**Acceptance scenarios for the future implementation**:

1. A transaction with multiple allocations can have several attachments of different file types. Authorized users can download original contents with the retained filename and file type; attachments belong to the transaction rather than individual allocations.
2. A user who can read the transaction can read its attachments, including historical attachments on a shared account. Adding or removing attachments requires transaction-edit permission; unrelated files remain inaccessible.
3. A user saves a transaction with files while offline. The transaction remains saved while attachment synchronization is pending or failed, and the app reports that status. Downloaded files remain readable offline; missing local contents are identified as requiring download.
4. Removing one attachment retains the transaction and its other attachments. Deleting the transaction removes its attachments from ordinary access without physically deleting file contents still referenced elsewhere or required by the eventual recovery policy.
5. Adding or removing other files does not change an existing attachment's identity. Synchronization, backup, restore, and merging preserve attachment identities and relationships.

**Initial image attachment acceptance scenarios**:

1. A user can add up to five JPEG, PNG, or WebP images of at most 10 MiB each while creating or editing a transaction. Invalid type, oversized files, and selections exceeding the remaining per-transaction count are rejected with localized feedback.
2. Saving the transaction completes independently of image storage. A failed image upload does not undo or block the transaction save.
3. Transaction details show attached images with their selected names and allow preview, download, and removal without confirmation. Removal does not alter the transaction or other attachments.
4. Images exceeding 2048 pixels on either edge are resized proportionally, without cropping or changing the image type.

### Approved transaction history direction (future functionality)

- **FR-053 — Visible history and restoration**: Authorized users MUST eventually be able to inspect earlier transaction versions and restore a selected version as a new edit. Restoration MUST preserve transaction identity and existing history rather than erase intervening edits, and MUST remain subject to current permissions, workspace lifecycle restrictions, and financial validation. A general-purpose conflict-resolution interface is deferred.
- **FR-054 — History scope and SDK investigation**: Before implementation, verify the installed Jazz SDK's supported history/read/restore APIs and define a consistent transaction version across its main row and related allocations, tag assignments, and other associated records. Jazz synchronization reconciliation MUST NOT be assumed to enforce application financial invariants such as allocation totals or valid transfer pairs. Related-record version boundaries, restoration effects on shared references and transfer counterparts, and handling of concurrent changes during restoration remain unresolved design decisions; no complete transaction-history or revert capability is claimed by current creator/latest-editor metadata.
- **FR-055 — Backup merge distinction**: Importing a backup into an existing workspace is not covered completely by the login-identity account-merge specification. Its future design SHOULD reuse applicable provenance, duplicate-detection, retry, and conflict-reporting rules from `003-account-data-merge`, but MUST explicitly define backup input, destination eligibility, and support for the complete included graph, including attachments, allocations, and transfer links. Restore into a new workspace remains the approved backup restore behavior; merging into an existing workspace remains deferred.

**Acceptance expectations for future planning**:

1. Restoring an earlier transaction version produces a new authorized edit while retaining the transaction ID and intervening history. Invalid financial combinations cannot be introduced by restoration.
2. The history design explicitly establishes which related records belong to each displayed/restorable version and how concurrent changes are handled, based on verified SDK capabilities rather than assumptions about internal row history.
3. Backup-to-existing-workspace merging is specified separately before implementation and does not silently omit related data or treat login-identity merge support as sufficient.

### Out of scope for MVP

- Scheduled or automatic SimpleFIN imports remain out of scope. Explicit setup, account discovery/linking, and manual transaction import are governed by [002-manual-bank-sync](../002-manual-bank-sync/spec.md), including its credential, authorization, cancellation, and idempotency requirements.
- Foreign exchange conversion. The approved multi-currency foundation above constrains implementation and compatibility; it does not authorize automatic or reported conversion.
- Transaction attachment image upload, transaction batches/templates, advanced invites, fine-grained sharing UI, and Capacitor/Tauri native wrappers.
- Linked-transfer implementation and migration. The approved transfer foundation above uses linked expense/income transactions rather than a third transaction kind.
- Split-transaction implementation and migration. The approved foundation above constrains future design without requiring split functionality in MVP.
- Backup/restore support for future data types not yet released. A verified recovery path for released MVP data types is required by FR-056, following the approved backup/restore rules above.
- Transaction version-history/restoration UI and a general-purpose conflict-resolution interface. Supported history APIs and related-record restoration consistency require investigation before implementation.

## Data Model Invariants

- Financial accounts are distinct from login identity and organization tenancy.
- `amountMinor` is a non-negative integer; the sign is represented by `kind`.
- Currency is copied from the account at creation and stored on the transaction.
- Current MVP storage requires `categoryId`, `accountId`, and `organizationId` on every transaction. The approved future allocation model below moves categorization to allocations without changing the transaction's account movement or identity; that migration is not implemented.
- Check metadata lives on independent account-scoped Checks. Transactions store a Check reference; multiple compatible transactions may reference one Check. Exclusive assignment is deferred.
- `source` is a discriminated union in application types: manual, or SimpleFIN with `externalId`.
- Jazz owns synchronized durable data and system audit timestamps.

## Key Entities

- **Profile**: login-identity display profile with a display name and optional avatar, reused across workspaces. Profile avatar upload is included in MVP scope.
- **Organization**: personal or business workspace with a default currency.
- **Organization Member**: organization/user association with owner, admin, member, or viewer role.
- **Account**: cash/bank/card ledger belonging to an organization; archivable and fixed to one currency. Feature 011 initially supports USD and TZS for manually created accounts.
- **Account Membership**: explicit read/write grant to an account for an org member in `selected` access mode.
- **Category**: org-scoped expense/income classification; system Uncategorized entries cannot be deleted.
- **Tag**: org-scoped income/expense label with optional matching-kind category; can be archived.
- **Transaction**: account-linked income or expense, with amount, currency, date, category, source, optional description/memo/provider id/batch, and tags.
- **Transaction allocation** (future): an independently identified portion of a transaction, with amount, category, optional description, and tags. See the approved split-transaction foundation below; current category/tag storage remains unchanged until a separately reviewed implementation.
- **Internal transfer** (future): a relationship pairing an expense and income in different accounts of one workspace, subject to the approved currency, reporting, lifecycle, and authorization rules above.
- **Check**: independently identified, account-scoped payment metadata usable by income and expense transactions; a Check can remain detached after cancellation, failure or reference removal.
- **SimpleFIN Connection / Account Link**: org-scoped connection credential/status and mapping to local accounts.
- **Transaction Attachment / Batch**: schema-ready relationships for later features.

## Non-Functional Requirements

- **NFR-001**: Read/write flows for already available data MUST not require connectivity.
- **NFR-002**: Jazz permissions MUST prevent unauthorized organization/account access. SimpleFIN credentials MUST be persisted only as passkey-protected ciphertext bound to the connecting user, organization, and connection; Jazz membership or admin status alone MUST NOT provide a usable credential.
- **NFR-003**: Money handling MUST preserve exact integer minor units and the stored currency code. Manual amount entry MUST NOT impose a signed-32-bit or other product-specific ceiling. Parse decimal entry exactly before converting to the current JavaScript number representation; reject values beyond its safe-integer range rather than rounding or losing cents.
- **NFR-004**: Main flows MUST work on mobile-size screens and with keyboard/screen-reader accessible controls.
- **NFR-005**: Native SvelteKit service-worker caching MUST cover public page shells and build assets and coexist with Jazz's persistence and synchronization. Jazz data/auth/sync requests MUST NOT be added to the service-worker runtime cache.
- **NFR-006**: The automated test suite MUST include unit tests and browser-level Playwright tests and run reliably in local development and CI.

## Assumptions and Dependencies

- Jazz Cloud is the initial hosted sync/auth option; self-hosting can be considered later.
- Personal org defaults to USD and English. The schema stores currency codes for future multi-currency use.
- The starting repository is initialized for Spec Kit and Codex; application scaffolding is the next implementation phase.
- Planned GitHub namespace is `https://github.com/delightful-labs/`.

## Success Criteria

- **SC-001**: A new user can sign in and reach a reusable personal workspace without manually creating an organization.
- **SC-002**: A user can create an account and enter/list income and expense transactions with categories and tags.
- **SC-003**: Every saved transaction satisfies the data invariants above and is tied to exactly one account and organization.
- **SC-004**: Previously available data and local account/transaction writes remain usable without network access.
- **SC-005**: Permission rules prevent cross-organization access and protect SimpleFIN credentials from member/viewer roles.
- **SC-006**: Every visible label, hint, and error in shipped UI is sourced from Paraglide messages.
- **SC-007**: Every shipped application module has appropriate unit coverage, and each primary user workflow has a passing Playwright end-to-end test.

## Delightful UI Integration Trial and Future Components

The approved trial replaces applicable existing controls with Delightful UI and imports its full default light theme. This is an explicit exception to the wireframe-only presentation default. Existing responsive layouts, Paraglide labels, native form semantics, permissions, local-first persistence, integer money and date-only values remain requirements. Amount entry stays text-based; keypad workflows and new domain features are deferred. Form layout spacing uses grid/flex gap, with a small gap between fields and a larger gap before actions; sibling spacing should generally use gap rather than margin or padding.

Future reusable component proposals, based on integration call sites, are currency-entry composition, linked field help/error feedback, status feedback, semantic table presentation and navigation/layout primitives. These are candidates for later library specifications, not additional MVP requirements. See `docs/delightful-ui-integration.md` and linked code comments for evidence, current solutions and ownership boundaries.

Recovery phrase revelation uses the library's native modal Dialog with translated warning, read-only phrase and saved confirmation. Completion requires confirmation, while backdrop clicks, Close and Escape allow immediate dismissal. The dialog uses native `closedby="any"` light dismissal. Every dismissal clears the phrase and confirmation state; closed dialog content excludes the phrase.

Finance owns responsive drawer policy: at viewport widths up to and including 48rem, navigation starts closed and selecting a sidebar link or Sync now dismisses it. Above 48rem, navigation starts open and those actions preserve its open state. The toggle works at every width. Resizing alone preserves the user’s drawer state; subsequent actions use the current viewport width. Delightful UI supplies the controlled drawer and navigation primitives without device detection or link-dismissal policy.

On mobile, opening the drawer pushes the full-width main content offscreen rather than shrinking it. The drawer occupies the viewport width minus a 3.5rem strip of main content; horizontal overflow is clipped. Desktop retains the space-reserving drawer and flexible main-content width.

While mobile navigation is open, main content is inert. A transparent, accessibly named Close navigation button covers the visible main-content strip; activating it closes the drawer and returns focus to the navigation toggle. Resizing updates inertness without changing drawer disclosure. Desktop main content remains interactive.

### Sidebar settings navigation

Group Workspace (`/settings/workspace`), Banks (`/settings/banks`), and Account (`/account`) inside a Settings disclosure using the shared Details component. Both Accounts and Settings disclosures start closed. Label the account page Account, retain recovery-specific section copy, and label the sign-in navigation and submit action Login. Include decorative icons beside each sidebar menu item.

The Accounts disclosure sits immediately above Settings and contains the account management link, account filters, and Add account action. The workspace selector lives inside Settings and is labeled Current workspace. Only a link matching the current page receives `aria-current="page"`; highlight it with the green theme accent background, black text, and no underline.

### Sidebar account order

Accounts provide an Edit order button below the list only when there is more than one account. Editing reveals right-aligned up/down buttons, disabled at their respective boundaries; Done exits editing. Moves apply immediately and retain checkbox selection. Store this personal browser preference per identity and workspace; new accounts append in name order. New transaction defaults follow sidebar order. Changing identity/workspace exits editing. If browser storage is unavailable, ordering remains usable for the current session.

### Sidebar icon alignment

Use DUI right-positioned carets for Accounts and Settings. Remove drawer inner padding and Details borders, including the content divider. Navigation links and disclosure summaries share the same horizontal inset so their icons align. Details child content retains 1rem theme spacing on all sides.

### Responsive categories table

Category settings use the shared DUI Table with a localized caption and keyboard-focusable horizontal scrolling so all columns and archive actions remain reachable on narrow screens.

### Category creation modal

Category creation opens in a DUI modal from an Add category button. Preserve validation and save feedback. After success, Close dismisses the modal; reopening starts a new entry. Provide a localized Cancel button, Escape/backdrop dismissal, and native focus restoration. Dismissal retains the draft; workspace changes close the modal and reset the existing workspace-scoped form.

### Page content spacing

Shared page content separates sibling content blocks, including category tables and creation buttons, with theme spacing through CSS gap.

### Tags table and creation modal

Tags use the same responsive DUI Table and creation modal pattern as categories. Add tag opens the modal; Cancel precedes the primary Add tag action. Preserve category selection, validation and save feedback. After success, Close dismisses the modal; reopening starts a new entry. Dismissal retains drafts; workspace changes close and reset the form. The table and trigger render directly in the route; no shared PageContent spacing wrapper is used.

### Shared creation modal and transaction account setup

Account, category and tag creation share a modal form presentation with Cancel first, a primary Add action, equal-width controls, native dismissal/focus behavior and existing validation/save feedback. Users with no active accounts can create one directly from expense/income lists and entry pages without navigating away. Accounts management uses the same reusable account creation integration; the sidebar Add account button opens the modal directly, and /accounts/new is removed. Only owners/admins may create financial accounts. Workspace/identity changes close and reset account creation. Dismissal retains drafts and does not cancel an already-issued save. Success replaces the form and its Cancel/Add controls with success feedback followed by a single Close button. Opening a successful form resets it for a new entry; opening an unfinished form preserves its draft or in-flight save. The shared form machine owns this reopening transition.

Creation modal openers include a decorative plus icon; shared modal Add actions use a Save icon and Cancel actions use an X icon, retaining their localized labels.

### Transaction list pagination

Income and expense lists use the locally bundled Delightful UI Pagination and PaginationItem components. Each page shows at most 25 transactions, preserving newest-first date grouping and full daily totals for the selected accounts even when a day spans pages. Pagination is URL-backed presentation state: account, workspace, or transaction-kind changes reset it to page one; shrinking results clamp it to the last available page. Hide pagination for zero or one page. Provide localized page labels, current-page semantics, disabled boundary controls, a compact page range with ellipses, and an announced page status. Existing Jazz subscriptions and offline behavior remain in place; this limits rendered entries rather than database subscriptions. Implementation review precedes unit and browser coverage.

Development transaction samples: the global Developer menu exposes separate Add 25 sample income and expense transaction controls only in development. Each explicit click saves 25 clearly marked manual samples across five dates using existing validation and Jazz local writes, targeting the first selected writable active account and an active category of the current kind. A focused state machine owns sequential writes, progress, complete/partial/failure outcomes and cancellation. Scope changes stop subsequent writes; issued writes may finish. No automatic seeding or production control. Review before tests.

Pagination truncation uses a consistent number of slots for a given page count: show every page when there are five or fewer; otherwise show five slots including ellipses. Always show first, last, and current pages. Near either boundary, expand the numbered range to fill slots vacated by ellipses. Never replace a single omitted page with an ellipsis.

Transaction pagination reads the `page` query parameter, defaulting to one for missing, invalid, non-positive, or unsafe integer values. Real page links preserve other query parameters and the fragment, omit `page` for page one, and support sharing, reload, new tabs, and browser Back/Forward. Display clamps to available results without rewriting the requested URL during subscription loading. Account/workspace changes reset the URL to page one without adding a history entry; initial workspace loading preserves direct page links. No pagination state machine is introduced.

The development sample controls live in a global Developer menu dialog on every page. Its opener precedes page content in tab order, occupies no visible layout space, and appears at the top of the viewport while focused. Enter/Space opens the named modal; native Escape/backdrop dismissal and an explicit Close control restore focus to the opener. Dismissing preserves batch progress and does not cancel writes. This remains development-only.

The root layout mounts one self-contained developer menu and always renders the same income and expense actions, independent of route. Keep actions visible but disabled before a Jazz provider is available. Session-scoped sample integrations own subscriptions and batch actors, exposing presentation data/callbacks through root-owned context. Ordinary navigation preserves progress and active batches; identity/workspace/account-selection changes stop subsequent writes through scope checks. No page-specific menu registration or conditional item visibility.

DeveloperMenu encapsulates all development gating, menu content, disabled defaults, session binding and sample integrations. The shared layout only mounts `<DeveloperMenu />`. A pure DeveloperMenuDialog owns the focus-revealed trigger and modal presentation; sample integrations remain menu descendants and reuse the existing application session without creating another session.

## Category and tag kind/duplicate-name correction

Categories and tags require an income/expense kind. Active names are unique within
organization + entity type + kind, comparing trimmed, lowercased names. Archived
items do not reserve names. A tag's optional category must match its kind, and
transaction tag choices and inline creation must match the transaction kind.
Duplicate decisions belong to explicit guarded state-machine transitions before
persistence, using refreshed local observations; presentation renders the machine
result and retains entered values. Offline creation remains supported. Concurrent
creation on disconnected devices is not guaranteed globally unique by this check.

Implementation sequence and review gates:

- Implement category duplicate-name assessment in the existing management machine,
  bind submitted name/kind in the category page, and localize the blocked outcome.
- Review this implementation before adding or running its unit/Playwright coverage.
- Add tag kind to schema, validation, settings and transaction workflows; enforce
  matching-kind category references and machine-owned duplicate checks in both
  settings and inline transaction creation.
- Decide and review existing-tag migration before changing stored data: linked,
  unlinked, and mixed-kind historical usage must retain their associations without
  guessing a kind or silently dropping history.
- Review each focused implementation before its tests and the next task.

Category, account, and tag duplicate assessment and new-tag kinds are implemented and approved, with focused verification passed. The additive tag-kind schema migration is prepared locally; assigning kinds to existing untyped tags remains deferred.

### Account-name duplicate validation scope

Account creation must also reject a name already used by an active account in the
same organization, comparing trimmed, lowercased names across cash, bank, and card
kinds. Archived accounts do not reserve names. The account creation state machine
must own the duplicate guard and explicit duplicate outcome, using current local
account observations after authorization and before issuing the write. Preserve
entered values and render localized feedback. The same offline concurrency limit
as category/tag duplicate checks applies.

- [x] Implement account observations, submitted-name assessment, machine guard,
      duplicate outcome and localized feedback in a separate focused review cycle.
- [ ] After implementation approval, add and run relevant unit and Playwright
      coverage for case/whitespace, organization scope, cross-kind duplicates,
      archived names, and a duplicate appearing while the form is open.

Account duplicate validation and shared name normalization are implemented and approved, with focused verification passed.

### Accepted transitional tag storage policy

Require a kind on every new tag, but retain nullable kind in storage for existing
rows. Preserve all historical links; exclude untyped tags from new assignment
until a separately reviewed migration assigns or splits them. Show their unassigned
status in tag settings. The compatibility policy and machine ownership are detailed
in [tag-kinds.md](tag-kinds.md). No remote schema deployment is included in this work.

### Transaction description

Transactions have an optional primary description alongside memo for additional notes. Manual entry uses a single-line Description input and a Memo textarea. Both values are trimmed and blank values are omitted. Lists show description; details show description and memo separately. New SimpleFIN imports store provider descriptions in description, and sample transactions populate description. Existing rows remain valid without a description and existing memos are preserved without copying or backfilling.

### Category and tag archive filters

Category and tag settings each offer a native radio group with Default (not archived), Archived only, and All. Default is selected on page entry. Hide the tag archive filter when the workspace has no tags; retain it when only the filtered result is empty. Filtering retains workspace scoping, alphabetical order, historical counts and category labels, and existing archive authorization.

### Desktop transaction workspace

Mobile transaction detail pages provide a localized Back to list link to the matching income or expense index, preserving URL pagination. This link is hidden on desktop and creation pages.

Income, expense, new-transaction, and transaction detail routes share a SvelteKit route-group layout using `/income`, `/income/new`, `/income/[id]`, `/expenses`, `/expenses/new`, and `/expenses/[id]`; detail URLs belong to their transaction kind rather than `/transactions/[id]`. Above the existing 48rem mobile breakpoint, the transaction list occupies a right-side Drawer, initially open. The center remains empty on income/expense index routes; new and selected transaction content renders in the center. The drawer can be closed and reopened using accessible controls and reuses the same UI Drawer as main navigation, including Escape and focus-return behavior. Its list remains available while navigating between entries and forms, with the URL determining income/expense list content. Pagination stays in the URL and is preserved when selecting a transaction or opening creation. On mobile, index routes show the list and new/detail routes show only their existing content. Viewport changes must not remount the center form or discard unsaved input.

After successful local transaction creation, navigate from `/income/new` or `/expenses/new` to its section index (`/income` or `/expenses`), replacing the creation history entry. Validation failures, save failures, partial outcomes, and cancellation remain on the form. Editing retains its existing behavior.

Income and expense creation forms provide a localized Cancel button beside Save. Cancel navigates to the main Overview page (`/`) without submitting or validating the draft.

Creation keeps the entered form visible until index navigation completes; do not display an intermediate success/add-another screen.

The transaction workflow machine owns navigation after creation. Navigation failure reports that the transaction is already saved and allows retrying navigation without saving again. Form fields remain visible but disabled through navigation; no intermediate success screen appears.

### Category loading layout

Category settings keep the page heading, archive filter/list area, and Add category
control rendered beneath an inert loading overlay while queries load. Use a shared
loading presentation with the existing Jazz startup spinner. Keep existing error
feedback and authorization checks. This reduces layout changes without reserving
placeholder rows for records that have not loaded. Implementation reviewed for testing. Focused coverage checks loading accessibility,
retained controls and layout, error precedence, and category creation after loading.

### Transaction attribution avatars

Transaction details show each available profile avatar beside its creator and latest
editor name. Missing or unreadable images retain the display-name/account-ID fallback.
A reusable pure avatar display receives image bytes and MIME type, owns and revokes
its object URLs. The account settings avatar input is prefilled with a File made
from the saved image bytes and supplies its own preview. Adjacent-name avatars
are decorative for accessibility. The settings input retains its localized labels,
replacement save action, and a single input removal button. It removes a saved
avatar through the existing workflow or clears an unsaved replacement to restore
the saved preview. No new subscription, permission, or workflow state is added.

Transaction detail creator/editor attribution, avatars, and timestamps appear inside
a DUI Details disclosure labeled Metadata, closed by default. The editable form
remains outside the disclosure.

### Transaction page transitions

Client-side navigation between income/expense index, creation, and detail paths uses
the native View Transitions API to slide the incoming content from one full viewport
width to the left (`translateX(-100vw)`) to its natural position over 300ms with
ease-out timing, without fading. Keep surrounding navigation and the desktop transaction
drawer still. On mobile, transition between the list and form/detail content.
Respect reduced-motion preferences
and fall back to immediate navigation when unsupported. Query/hash-only changes and
navigation outside transaction routes do not start a transition. Initial page loads
retain their existing behavior.

Incoming transaction content retains its natural rendered size during the transition,
anchored at the top left. Loading transaction data or changing the form height during
the animation must not stretch or squash the incoming page snapshot.

### Editing imported transactions

Imported income and expenses MUST support authorized edits to categories, tags,
description, memo, amount, business date and account through the transaction form.
Edits MUST preserve transaction identity, workspace, kind, provider source and
external ID. Imported income without a payment method MUST retain that omission unless the user explicitly selects a method;
editing MUST NOT convert it to manual income or default it to cash. Repeating
manual bank sync MUST recognize the existing provider identity and preserve user
edits without creating a duplicate or overwriting the transaction. Existing
account/category validation, permissions, attribution, local durability and scope/
shutdown settlement rules apply. The shared independent Check contract in `009-independent-checks` applies to imported and manual transactions alike.

### Drawer styling boundary

Finance MUST configure the navigation Drawer panel separator through the public
`--dui-drawer-panel-border-inline-end` custom property, preserving its existing
logical end border, responsive sizing, scrolling, and open/close behavior. Finance
MUST NOT select the private `.inline-panel` element to style that separator.

### Details styling boundary

Finance MUST own custom Details content/caret markup through snippets, preserving
native disclosure semantics, sidebar spacing, transaction grouping, and summary
hover colors. Default children retain the library presentation; absolute content
retains a library-owned positioning/overflow frame. Consumer CSS MUST NOT
select private `.details-caret` or `.details-content` classes.

### Shared navigation icon presentation

Navigation link and drawer action/disclosure icons MUST share AppIcon's
`navigation` presentation variant, preserving their current size, alignment,
and spacing. Top-menu refactoring MUST preserve accessible toggle behavior,
header/logo geometry. The shell grid supplies the header row and remaining viewport
height without JavaScript header measurement.

### Global CSS exceptions

Necessary cross-snippet, imported-SVG and browser view-transition styles MUST use
readable native global blocks with explicit application boundaries where available.
Preserve form button wrapping, transition keyframes, and reduced-motion behavior;
do not add a styling dependency or extra markup solely to avoid global selectors.

### Simple selector cleanup

Category legend styling MUST target its native buttons and named amount element
without depending on ancestor or child position. Sidebar disclosures MUST retain
spacing without redundant content-group wrappers. Transaction index visibility
MUST use the native hidden attribute with a local override for layout display.
StatusMessage compact spinner sizing MUST inherit from its presentation root.

### Optional DUI composition

DUI feedback/message, step-label and drawer-close snippets MUST preserve existing
default callers. Custom content replaces only its documented presentation region;
status announcements, step semantics and drawer dismissal/focus ownership MUST
remain explicit. Finance need not adopt custom markup without a concrete use case.

### Typography and Button styling

Typography MUST retain semantic heading levels, default sizes, inherited omitted
alignment, caller inline styles and public font-size overrides while minimizing
variant selectors. Button MUST retain public theme overrides, native/fieldset
disabled behavior, ARIA-disabled activation handling, flat/raised combinations,
keyboard focus, reduced motion and forced colors with shared interaction rules.

### Viewport shell and shared drawer sections

The application shell fills the dynamic viewport with a header row and a remaining
workspace row. Main content scrolls within the workspace. Navigation and transaction
drawers inherit their available height rather than calculating header offsets.
AppDrawerContentSection owns the shared content grid and padding for account filters,
workspace selection, and the navigation footer, preserving labeled-section semantics
for account filters. The footer groups sync controls and connection/update status.
Route and dialog content render directly without the generic PageContent wrapper;
TransactionView owns its content grid and a sticky trailing creation action.

## Finance presentation extraction — complete (2026-11-03)

The agreed extraction batch is merged in both repositories:

| Shared presentation                            | DUI PR                                                          | Finance adoption PR                                                   |
| ---------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| NavigationLink, NavigationGroup, DrawerSection | [#9](https://github.com/delightful-labs/delightful-ui/pull/9)   | [#47](https://github.com/delightful-labs/delightful-finances/pull/47) |
| LoadingContent                                 | [#10](https://github.com/delightful-labs/delightful-ui/pull/10) | [#48](https://github.com/delightful-labs/delightful-finances/pull/48) |
| LinkedListRow                                  | [#11](https://github.com/delightful-labs/delightful-ui/pull/11) | [#49](https://github.com/delightful-labs/delightful-finances/pull/49) |
| FloatingActionLink, FloatingActionButton       | [#12](https://github.com/delightful-labs/delightful-ui/pull/12) | [#50](https://github.com/delightful-labs/delightful-finances/pull/50) |

DUI owns generic presentation and native control behavior. Finance retains routing/query
resolution, selected-route policy, localization, financial formatting, data and workflow state.
Floating actions are separate native link and button components with native attributes and
children; their shared presentation frame is private. No combined Omit/never link/button API
is part of the accepted interface.

The user closed this extraction batch. SplitRow, selectable legends, and photo-cropper/image-editor
extraction are not planned tasks. Keep them in Finance and reconsider only when another app has
a concrete need. The earlier app-specific candidate the user chose to skip remains excluded.
This completion does not close unrelated historical review or accessibility-verification work.
