# Tasks: Delightful Finance MVP

**Input**: [spec.md](spec.md), [plan.md](plan.md)
**Feature**: `001-finance-mvp`

## Checkpoint status

Reconciled against the implementation, existing tests, and recorded verification on 2026-10-14. Checked tasks have implementation and relevant recorded passing checks. Test results below reflect separate checkpoints and runs, not one combined passing current-tree verification.

### Remaining MVP work

- **T040 — Remaining browser verification:** Automated offline/access and production-PWA coverage is now verified on 2026-10-25 (see the final readiness record below). Native installation-prompt/device review remains manual.

### Verified foundations

- Scaffold, strict TypeScript, source/test layouts, XState form workflow, Paraglide integration, and approved Delightful UI integration are implemented. Application/service-worker and browser-test type checks have recorded passing results.
- Core entity schemas, canonical Zod adapters, integer money helpers, account create/list/archive, income/expense forms and grouped lists/details, categories/tags, workspace switching/naming, and transaction attribution have recorded unit/browser coverage in the task notes below.
- Check-detail integrity (T009) is verified with the detail-first model: initial reference checks, immutable selection, account/workspace grants, required dates, and atomic rollback. Latest focused checkpoint: 106 unit tests and 23 relevant browser scenarios passed.
- Real-server permission coverage includes roles, selected/all account access, zero/orphan grants, viewer write denials, admin-only provider credential reads, category-move rejection, and transaction-tag workspace/archived-history constraints. Full invite/grant-management UI stays deferred (T047).
- Authentication, personal-workspace bootstrap/reuse, protected starter categories, profile names/avatars, and shared-profile reads are implemented. Latest profile checkpoint: 43 persistence/bootstrap unit tests and 19 relevant browser scenarios passed; type/format checks passed. See T049–T051.
- Native service-worker/PWA coverage includes offline direct navigation/reload, public cache boundaries, and updates preserving drafts. Multiple-tab activation is now verified under T040; installation prompts still need review.
- Pre-alpha resets were explicitly authorized. No migration files are retained; another destructive reset still needs separate authorization.

Deferred T043–T048 are outside MVP. T023 was removed when account-detail/history routes were dropped; its number is intentionally unused. The composition refactor is T057 (formerly a duplicated T052).

## Phase 1: Scaffold

- [x] T001 Create SvelteKit app using the Jazz Svelte starter and configure strict TypeScript.

- [x] T003 Establish accessible native HTML controls and minimal layout CSS; add visual styling only after user approval.
  - Verified foundation: native controls and the approved Delightful UI theme are integrated (T052–T056). Broader responsive/keyboard review is deferred under T039 until after the post-MVP design revision.
- [x] T004 Add XState and `@xstate/svelte` for stateful feature workflows.
- [x] T005 Add Paraglide JS with an English message catalog and route all visible UI text through messages.
  - Verified integration: nested English catalog, Paraglide compiler and message calls are present. The complete visible-string/formatting audit remains T041.
- [x] T006 Add a native SvelteKit service worker, web app manifest, and prerendered public page shells without caching Jazz data/auth/sync.
- [x] T007 Establish source and test layouts for schema, permissions, money helpers, machines, routes, and static assets.

## Phase 2: Schema and Permissions

- [x] T008 Define Jazz schemas for profiles, organizations, organizationMembers, accounts, accountMemberships, categories, tags, transactions, and transactionTags.
  - Verified implementation: composed entity schemas in src/lib/schema; boundary/domain units and recorded real-server permission tests cover their use. Shared-profile schema publication is verified in T050.
- [x] T009 Define checkDetails as a one-to-one related record and model check-income requirements in application types.
  - Verified detail-first model: checkDetails stores organizationId/accountId relations and insertion uses account write permission plus matching active-account validation. The writer inserts the detail before its parent in one database transaction. Parent insert/update policies require an existing detail matching transaction/account/workspace IDs. Selection is singular/immutable; detail edits preserve ownership references, reassignment and deletion are denied, and reads follow account grants.
  - Verified on 2026-10-15 after explicit reset/test authorization: schema and permissions published successfully; 106 focused unit tests, 10 check-detail integrity/access browser scenarios, and 13 transaction form/detail/tag browser scenarios pass. Application, browser-test and worker type checks pass; changed-file formatting/diff checks pass. Fixtures verify detail-first order and context. Coverage includes initial absent/shared/cross-account/cross-workspace references, rejection of details on archived accounts or mismatched account/workspace pairs, required dates, valid edits, atomic rollback, competing selections, reassignment/deletion, all nine role/grant cases, and offline/tag/detail workflows. Five stale amount-label locators were updated to the current approved form label. No migration files retained; no commit made.
  - Scope of one-to-one association: directly written unselected candidates are permitted under account authorization, but a transaction selects only one matching record and another transaction cannot share it. Concurrent dependent attempts can return cascade_rejected after a root permission denial; assertions also verify the selected record remains unchanged. Earlier reverse-collection/negative-existence/circular-check attempts are superseded; the initial-reference gap is now closed.

- [x] T010 Define SimpleFIN connections and account links; make Access URL owner/admin-readable only.
  - Verified schema/policy readiness: integration tables exist; role/grant browser cases cover owner/admin credential access and member/viewer exclusion. Claim/import UI remains deferred.
- [x] T011 Add transaction source/externalId/batchId and schema stubs for file/attachment and batch records.
  - Verified schema readiness: transaction provenance/batch fields and attachment/file/batch tables are defined. Full UI/worker implementations remain deferred; transaction boundary tests cover manual/imported variants.
- [x] T012 Implement org role and account-grant read/write policies, using explicit `accountAccessMode`: `all` grants org-wide access; `selected` requires account grants and zero grants means no account access.
  - Verified by recorded real-server role/grant cases, including selected mode, zero grants, orphan grants, and viewer write denial; affected detail/profile cases were rerun at T050.
- [x] T013 Enforce account/org/category consistency and required category/kind/currency relationships in writes.
  - Verified implementation: account/category workspace, currency, kind, and archive guards are in permissions.ts and canonical adapters. Recorded coverage includes category-move rejection and transaction-tag cross-workspace rejection. Check-detail integrity is verified in T009.
- [x] T014 Document/resolve Jazz permission limitations around grant-aware queries before enabling selective sharing.
  - Verified scope: plan.md documents explicit all/selected access; real-server tests cover zero/orphan grants and readable transaction/category counts. Queries remain permission-scoped. Shared profiles require a declared membership profileId relation (T050); missing links grant no shared reads. Sharing-management UI remains deferred, not enabled by this task.
- [x] T015 Add unit tests for schema-boundary adapters and permission rules, including unauthorized and grant edge cases.
  - Verified at the appropriate boundaries: canonical/schema-adapter unit tests plus real-server permission tests cover unauthorized roles, grants, category moves, and tag links. Permission enforcement is exercised against Jazz rather than a mocked rule evaluator.

## Phase 3: Authentication and Personal Organization

- [x] T016 Wire Jazz authentication and app session state.
  - Verified: shared local-first session, restore flow, malformed recovery phrases, and cross-device recovery have passing authentication coverage. Network/session failure and retry coverage is verified separately in T058.
- [x] T017 Create/reuse a profile, personal organization, and owner membership on first login.
  - Verified: bootstrap idempotency, reload/recovery reuse, profile linkage/repair, local persistence, and existing-workspace isolation have unit/browser coverage (T020/T050).
- [x] T018 Seed protected Uncategorized expense and income categories for each new organization.
  - Verified: bootstrap seeds both protected system categories; units and category/default-category browser cases cover reuse and protection (T028/T031).
- [x] T019 Add a minimal signed-in shell and route guards based on Jazz permissions.
  - Verified: bootstrap gates app rendering, the app shell preserves session/workspace across navigation, and scoped queries/server policies enforce access. Permission and missing/other-workspace detail scenarios have passing browser coverage.
- [x] T020 Add unit tests for bootstrap idempotency and Playwright coverage for first sign-in/workspace setup.

## Phase 4: Accounts

- [x] T021 Build the organization account list and account creation flow for USD ledgers.
  - Verified: canonical account validator, shared form/data writer, active account list/sidebar, and recorded create/list/workspace/reload browser coverage. See T024.
- [x] T022 Support archiving accounts and exclude archived accounts from new transaction selection.
  - Verified: AccountList offers Archive to owners/admins and members with write access. A shared form-machine action validates account/workspace IDs and waits for local persistence. The account/transactions are retained; existing queries exclude archived accounts from active lists and new-entry options. After review, 44 focused unit tests and eight browser tests pass, including offline archive/sync, retained history, new-entry exclusion, list regressions, admin/member writes, and read-only member/viewer server denials. Application/browser-test type checks pass. Run type checks before browser suites: generated-file updates can trigger dev-server reloads during fixtures.
- [x] T024 Add unit tests for account validation/behavior and Playwright tests for account create, list, archive, and retained history in the income/expense views.
  - Verified: canonical account and persistence unit tests; create/list/archive browser checks cover validation/retry, workspace draft resets, retained history, selected grants, offline archive/sync, and server denials (T022).

## Phase 5: Transactions, Categories, and Tags

- [x] T025 Add integer minor-unit money parsing/formatting helpers and USD form controls.
  - Verified: parseAmountMinor/formatMoney unit tests cover decimal parsing, invalid/overflow inputs, nonnegative integer values and currency formatting. Form/list browser tests cover USD entry and displayed amounts.
- [x] T026 Implement expense/income transaction domain unions and Jazz boundary mapping without `any` or `as`.
  - Verified: canonical transaction unions, boundary mapping and normalization have recorded unit coverage; form/check/tag browser cases exercise persisted shapes.
- [x] T027 Build XState transaction form: draft, validate, save, success/error; support local-first writes.
  - Verified: the shared XState form machine supplies validation/save/success/error/reset actors; machine, schema and persistence units plus form retry/reset/local-write browser tests pass. No separate transaction-specific machine is required.
- [x] T028 Require matching-kind category and default to the corresponding Uncategorized category.
  - Verified: the native category select defaults to the active workspace’s unarchived system category for the transaction kind. The Zod adapter uses the same fallback only when no category ID is submitted; explicit choices remain validated. Matching uses system identity rather than the category name. Unit coverage and both expense/income browser cases pass for defaults, explicit overrides, live category updates preserving selections, reset, and workspace switching. Native date reset restores today through `defaultValue`.
- [x] T029 Add income payment methods; require and save check details only for check income.
  - Verified: check-number/date inputs only render for Check and both are required. Canonical check-income validation requires a valid date and nonblank number; its writer always persists the date. Inputs remain uncontrolled, with a small visibility state synchronized by the native select and Svelte attachment. After review, 68 focused unit tests and five browser regressions pass, including missing/empty/invalid check dates, persisted required dates, conditional visibility, native required validation, Zod validation retry, and workspace/form resets. Application/browser-test type checks pass.
- [x] T030 Build transaction list/detail views with date, account, amount, category, memo, and tags.
  - After review, six detail browser cases pass for keyboard list-link navigation, related account/category/tag records, check-income details, live updates/reload/back navigation, selected-workspace/missing-row handling, viewer account grants, and member editor attribution. Browser-test type checks pass. Run `pnpm test:workspace --grep "transaction details"`.
- [x] T031 Build category settings with org-scoped create/archive and protected system categories.
  - Verified after review: category creation, trimmed-name validation/retry, both kinds, workspace switching/draft reset, reload persistence, connected transaction/tag counts, offline archiving/sync, retained history, archived-category exclusion from new entry, and system-category protection. Admin/member creation and archiving pass; viewers have disabled controls and server-denied writes. Selected-account count coverage confirms unreadable transactions are excluded. 43 focused unit tests and six browser tests pass; browser-test type checks pass. Run `pnpm test:workspace --grep "category page"`.
- [x] T032 Build tag settings with optional category assignment and archive behavior.
  - Verified after review: tag creation with/without categories, trimmed names and validation retry, active workspace category options, retained names for archived categories, reload persistence, workspace draft reset/isolation, offline archive/sync, and retained category connections/counts. Admin/member creation and archiving pass; viewer controls are disabled and direct writes are denied by the server. 50 focused unit tests and five browser tests pass; browser-test type checks pass. Run `pnpm test:workspace --grep "tag page"`. Transaction tag selection/assignment is verified in T033; the workspace-reference permission change has passing real-server coverage.
- [x] T033 Use Delightful UI TagInput for search, create, multi-select, and archived-tag exclusion, with the shared XState transaction form handling validation/save.
  - Verified after review: repeated FormData values are collected as arrays; canonical validation trims/deduplicates names. Saving reuses existing tags without changing their categories and creates new tags with the selected transaction category in the same database transaction. Local persistence gates success. 87 focused unit tests and four browser tests pass for expense/income tag entry, removal/deduplication/reset, category inheritance, archived-selection rollback/retry, workspace isolation, and offline creation/sync. Browser-test type checks pass. Run `pnpm test:workspace --grep "transaction tags"`.
- [x] T034 Add organization switcher state and settings shell; second-org creation/join flow may remain deferred.
  - Workspace naming: `WorkspaceNameForm`, active-workspace/role wiring, `/settings/workspace`, and unit/browser coverage are implemented. The sidebar link and navigation coverage are complete.
  - Shared form workflow: generic `Form` API reviewed; `WorkspaceNameForm` now supplies its schema, save operation, fixed workspace ID, and field/control/feedback snippets. The integration and settings page are reviewed; five form-machine unit tests and five workspace browser tests pass.
- [x] T035 Add unit tests for money/date/domain validation and transaction/tag state machines.
  - Verified on 2026-10-15: 111 focused unit tests pass across date-only/money helpers, transaction domain/grouping, canonical transaction/tag validation and the shared form machine. New todayDateOnly coverage has 18 cases, each passing in separate UTC, America/New_York and Pacific/Auckland processes. Covers zero padding, month/year boundaries, leap/century dates, New York daylight-saving boundaries, years below 1000, input immutability, default current time and repeated calls across local midnight. Production code is unchanged; no browser tests needed for this test-only addition. The shared form machine covers transaction/tag workflow states; no separate machines were introduced.
- [x] T036 Add Playwright coverage for expense/income entry (including check details), transaction history, category management, and tag selection/archive behavior.
  - Verified through recorded transaction/default-category/check/list/detail, category, and tag-selection/archive browser cases in tests/workspace.e2e.ts (T028–T033).

## Phase 6: Offline Shell and Polish

- [x] T038 Complete PWA offline shell behavior and ensure cache rules do not conflict with Jazz data.

- [x] T040 Add Playwright coverage for org access boundaries, credential visibility, sync/pending state, and supported offline writes/sync. Resolved within available automated scope by existing permission/sync tests and the 2026-10-25 combined offline/access matrix; actual-device installation review remains separately open.
  - Partial: role/grant/credential visibility and offline account/category/tag/profile write/sync cases have recorded passing coverage. All six current production-preview PWA browser checks pass, including a two-tab update lifecycle: drafts/controllers remain intact while waiting, closing one tab does not activate the update, closing the last controlled tab activates it, and a reopened tab uses the active worker. The generated worker fixture is restored after the test; production code is unchanged. Remaining: install-prompt review and review of the combined offline/access matrix. Authentication failures are verified under T058.
- [x] T041 Confirm all user-visible strings use Paraglide and all currency/date display uses locale-aware APIs.
  - Audited on 2026-10-15: page/component labels, titles, feedback, accessibility labels, bootstrap defaults, manifest metadata, and every money/date display. Localized bootstrap names while preserving deterministic seed IDs and existing saved names; moved install metadata to a prerendered Paraglide manifest endpoint at the existing URL; localized category counts and transaction tag-list punctuation with Intl. Existing money/date displays already pass the active locale, with UTC for calendar dates. Static application/service-worker checks pass without warnings. Full build generated the manifest but fails on the unchanged dynamic transaction route inheriting prerender=true without entries. Implementation reviewed and focused tests verified: 88 unit tests and four browser scenarios pass, including translation-driven seed names with original UUIDs/reuse, locale-aware count/tag formatting, manifest metadata/language/install URLs, and existing category/history/currency display regressions. Browser-test TypeScript checks pass. Follow-up production verification now passes for the manifest cache and transaction-detail route. Details are in plan.md under T041 Localization and Formatting Audit.
- CI verification attempt (2026-10-15): app/service-worker checks and browser-test TypeScript checks pass; all 264 unit tests pass; all 15 authentication tests pass; all six production-preview PWA tests pass after a successful production build. The base Playwright suite had two passing and five failing tests: an obsolete `src/routes/finance.e2e.ts` is matched, and several UI-integration cases timed out while workspace bootstrap was still loading. The permissions suite had 30 failures because its startup locator expects a complementary navigation landmark absent from the current shell. The workspace suite lost its development-server connection and reported 49 failures. Parallel attempts also contended for the Jazz dev-server RocksDB catalogue lock. These failures need investigation before claiming the browser suites pass; this work was not retained as CI configuration.

## Deferred Follow-up

- [ ] T039 Revisit responsive layout, keyboard/focus behavior, and interaction states after the planned post-MVP design and layout revision. Existing shell behavior has focused responsive/keyboard coverage; perform the broader review against the revised design rather than polishing the current layout prematurely.
- [ ] Revisit Jazz pending/sync-completion observability and the app-shell status indicator when the SDK exposes a supported whole-device signal. The current shell reports only local mode, browser offline state, or sync configuration; do not claim a completed sync. See the deferred sync-status observability investigation in plan.md.
- [x] Add GitHub Actions CI for application checks, unit tests, and Playwright suites. Resolved for committed revision 6243f75: run 40182572033 succeeds in all six jobs, including all four browser suites and production PWA. Uncommitted local additions are not yet covered by a GitHub run.
- T043 **Superseded** by constitution VI and [002-manual-bank-sync](../002-manual-bank-sync/spec.md): the original server-side claim/import-worker task is retired. Explicit client-initiated setup, passkey-protected credentials and manual imports are tracked under feature 002; scheduled/automatic imports are outside the approved design.
- T044 **Superseded tracking**: account linking and explicit manual import requirements, implementation and verification are tracked in [002-manual-bank-sync](../002-manual-bank-sync/spec.md) and its [tasks](../002-manual-bank-sync/tasks.md), rather than as an independent deferred MVP task. This reference does not declare every feature-002 requirement complete.
- [x] T045 Implement image attachments on transaction create, edit, and detail using Jazz streamed byte storage. Initial limits are five JPEG/PNG/WebP images per transaction and 10 MiB per selected image; resize proportionally to at most 2048 pixels per edge while preserving image type and filename. Support preview/download/remove and keep attachment failures independent of transaction save. Visible sync status and non-image files remain deferred. Add focused unit and Playwright coverage after implementation review.
  - Verified 2026-10-27: 76 focused unit tests and 61 Jazz permission tests pass. Four focused Playwright cases cover create/download/remove, edit/reload preview, per-transaction limit, and invalid/oversized feedback. Application and test TypeScript checks, schema validation, Prettier, and whitespace checks pass. Visible synchronization status and download-on-demand remain deferred per FR-050.
- [ ] T046 Implement transaction batch/template flows; include unit and Playwright coverage.
- [ ] T047 Add business-org creation, invite UX, and fine-grained account grant management; include unit and Playwright coverage.
- [ ] T048 Evaluate multi-currency entry/FX and native wrappers as separate specifications.

## Transaction Attribution and Login Profiles

- [x] T049 Select and display Jazz creator/latest-editor metadata for transactions, resolving author identities to profiles with fallbacks.
  - Verified in detail browser coverage: own display names resolve; authorized shared authors resolve to display names; missing names retain stable account-ID fallbacks. A member edit preserves creator identity/timestamp and updates latest editor identity/timestamp.
- [x] T050 Add owner-editable login profile name and avatar upload/replace/remove, with permissions for authorized workspace members to read author display profiles.
  - Verified after review: /account includes a props-only profile name form, canonical profile/form validation, and an identity-scoped save workflow that waits for local persistence. Blank names clear the display name for the existing account-ID fallback. All 62 focused validation/persistence/shared-machine unit tests and 23 browser scenarios pass across authentication and affected form workflows, covering trim/clear/reload, recovery on another device, workspace reuse, offline saving, attribution, owner-only writes, and ownership-transfer rejection. A shared form lifecycle fix uses a derived identity key so reactive profile updates do not reset save feedback. Application/service-worker and browser-test type checks pass. Shared-profile read permissions are verified below.
  - Avatar implementation reviewed: /account composes a pure ProfileAvatarForm with upload/replace/remove actions and a preview. The installed SDK's binary column primitive stores nullable bytes and MIME type on the profile; Zod validates PNG/JPEG/WebP uploads up to 10 MiB. Pica resizes them proportionally to at most 256 pixels, encodes a WebP avatar, and canonical validation caps the stored image at 256 KiB. Both fields update together and wait for local persistence under existing owner-only permissions. Identity guards are shared with the name save workflow. Type checks pass; all four avatar browser scenarios pass after the authorized development database reset and app namespace rotation. No migration files are retained.
  - Superseded attempt: the server rejected a userId-based join with JoinNotRefCompatible. The declared profileId reference implementation below replaced it and is now published/verified.
  - Verified revised implementation: nullable membership profileId and explicit profile/memberships relations replace the unsupported userId correlation. Bootstrap links or repairs the personal owner membership using the actual profile ID; future shared membership creation must supply that user’s profileId. After explicit authorization, development data and the app namespace were reset and the schema/policy published successfully. Seven real-server browser tests pass for admin/member/viewer shared reads, avatar bytes, missing links, unrelated/private-workspace isolation, reciprocal revocation on membership removal, named transaction authors, and owner-only edits/ownership-transfer rejection. 43 persistence/bootstrap unit tests pass, including linked-profile reuse and missing/incorrect link repair. All 11 authentication/profile/avatar browser regressions and the offline profile/workspace/attribution browser regression pass (19 relevant browser scenarios total). No migration files are retained.
- [x] T051 After implementation review, add unit and Playwright coverage for attribution, profile permissions, avatar lifecycle, missing-profile fallbacks, and persistence across workspace switches/recovery.
  - Profile-name coverage is implemented and passing. Avatar implementation was reviewed and tests authorized. All 219 unit tests pass, including resizing, initialization/resource cleanup, file/storage validation, and local persistence. A real browser processing check passes large-image resizing, proportion preservation, and no-upscale behavior; it caught a missing Pica initialization call, now fixed and regression-covered. After the authorized pre-alpha development database reset and app namespace rotation, all 11 authentication browser tests pass, including four end-to-end avatar scenarios. No migration files are retained. Both related workspace browser tests pass, including owner-only permission enforcement for avatar writes and rejection of profile ownership transfers. Shared-profile visibility is verified in the T050 notes above.

## Delightful UI Integration Trial

- [x] T052 Create an isolated Finance integration branch/worktree and consume a packed local Delightful UI snapshot with a compatible Svelte peer range.
- [x] T053 Apply the approved global theme and migrate applicable existing controls while preserving native forms, localization and business logic.
- [x] T054 Record evidence-based future component suggestions in code, integration documentation and the active spec/plan.
- [x] T055 Prepare implementation review: packaging/publint, production build, application/service-worker static checks and changed-file formatting pass; isolated preview was verified at http://127.0.0.1:5180 during that checkpoint (not a statement of current server availability). Implementation approved by the user.
- [x] T056 After approval, verify 89 focused unit tests and 27 browser scenarios for form defaults/resets, conditional check fields, workspace/filter state, recovery/restore, modal dismissal, archiving and permissions. Browser-test type checks pass.

## Page Composition Boundary Refactor

- [x] T057 Apply the clarified composition boundary across all pages.
  - Earlier page-specific controller extraction was superseded by the user's clarification: integration logic stays in pages or shared integration components, which compose imported pure components without declaring native HTML.
  - Implementation: moved login/recovery, account list/create, workspace/category/tag settings, transaction detail, and bootstrap/shell workflows into their owning Svelte integration scripts. Removed page-specific controller/query modules and their factory-style state wrappers.
  - Shared TransactionEntry and TransactionView integrations serve income/expense routes without duplicating workflows. Pure form/list/detail/shell components remain separate and receive props/callbacks. The genuinely shared form actor lifecycle remains in forms.svelte.ts.
  - AGENTS.md, constitution v2.1.0, plan, and form documentation reflect the clarified boundary. User explicitly authorized this full batch and immediate tests.
  - Verified: application/service-worker type checks report zero errors or warnings; browser-test type checks pass; all 175 unit tests, 45 workspace browser scenarios, and five authentication browser scenarios pass. Changed-file formatting and diff checks pass. A source audit confirms 12 integration files compose imported components without native body HTML, and no page-specific controller/query modules remain. No commit was made as part of that verification.

## Remaining Authentication Verification

- [x] T058 After reviewing the relevant implementation, add/run authentication network/session failure and retry coverage without replacing the active identity or exposing recovery phrases. Invalid phrase validation and successful recovery are already covered by T016/T050.
  - Verified 2026-10-15: startup and session errors offer retry through a shared XState machine. Restore feedback survives remounts; duplicate submissions/retries are blocked. Jazz owns identity selection and recovery. All 14 focused unit tests and 15 authentication browser tests pass, covering startup/network failures, repeated shutdown failures, selection-storage failures, shared-client errors, and existing recovery/profile flows. Recovery phrases stay out of error output, diagnostics, and URLs. Browser-test TypeScript and Finance static checks pass. See plan.md for details.

## Delightful UI component adoption, second review batch

- [x] Create a separate worktree from committed main for the refreshed UI snapshot.
- [x] Adopt the new components in query feedback, transaction entry, account list, app shell and avatar form; preserve business behavior.
- [x] Prepare static/build/format verification and a separate preview for implementation review. Static/service-worker and formatting checks pass; build compiles but reports the existing dynamic transaction route prerender configuration as a blocker. Preview: http://127.0.0.1:5181.
- [x] After user review, run 110 focused unit checks and eight browser scenarios for money/transaction/form/avatar behavior, table creation, sidebar layout/scrolling, mobile dismissal/focus, workspace navigation, recovery and avatar submission/removal. Browser-test type checks pass. Detailed invalid-field announcement coverage remains a follow-up.

### Responsive drawer navigation

- [x] Implement Finance-owned viewport-based initial disclosure and mobile-only sidebar link/Sync now dismissal in AppShell; inspect DUI for embedded policy.
- [x] After implementation approval, add and run focused coverage: the viewport utility unit test and five navigation browser scenarios pass, covering mobile/desktop startup, sidebar links including Add an account, manual toggling, reloads, breakpoint boundaries, and resizing. Application/service-worker checks and browser-test TypeScript checks pass. The resizing scenario emitted a ResizeObserver loop warning; all assertions passed. Sync now dismissal is not covered by these focused browser scenarios.

### Mobile drawer push layout

- [x] Keep mobile main content full width while the drawer pushes it offscreen, leaving a 3.5rem strip visible; preserve desktop layout.
- [x] Review the implementation, then add and run focused mobile/desktop geometry and horizontal-overflow browser coverage. Resolved by the 2026-10-25 focused UI verification below; broader design audit remains deferred.

### Mobile drawer accessibility

- [x] Make main content inert only while mobile navigation is open; add a native dismissal button over the visible main strip and restore toggle focus on activation.
- [x] After implementation review, add and run focused inertness, dismissal, focus restoration, and resize coverage. Resolved by the 2026-10-25 focused UI verification below.

### Sidebar settings navigation

- [x] Group Workspace, Banks, and Account in Settings Details; add sidebar icons and rename Account/Login labels.
- [x] After implementation approval, update and run relevant navigation coverage. Resolved by the 2026-10-25 focused UI verification below.

- [x] Move account navigation and filters into Accounts Details above Settings; move the selector into Settings as Current workspace.

- [x] Start both disclosures closed and highlight only the exact current-page link via aria-current with green background, black text, and no underline.

- [ ] T059 Default new income and expense forms to the first checked active account in sidebar order, retaining manual account selection.
  - Implementation ready for review: shared entry derives the default from ordered accounts and sidebar filters; the account select receives the default and resets with the form. No checked account leaves the placeholder selected. Open forms preserve account and category selections when defaults change.
  - After implementation approval, add and run focused coverage for all/some/none checked, list order versus checkbox click order, manual overrides, background default changes preserving open-form selections, add-another reset, and workspace changes.

### Sidebar account order

- [x] Implement viewing/editing statechart, personal browser ordering, boundary-disabled arrow controls and transaction-default alignment.
- [x] After implementation approval, add and run focused machine and browser coverage for moves, boundaries, selection preservation, reload, scope changes and new/archived accounts.
  - Six unit tests pass. All five browser scenarios pass: controls/persistence/new accounts, single-account/storage fallback, workspace isolation/archives, and direct-navigation defaults for expense and income. The controls scenario passed on a focused rerun after its first attempt preceded Vite readiness. Browser-test TypeScript checks pass.
  - Fixed the direct-navigation initialization race: resolve the preference synchronously and expose it through context rather than copying account IDs after render. The unchanged expense/income regression assertions now pass.
  - Browser validation used an isolated Vite server on port 5174 with the existing local Jazz endpoint; the original server had an empty public Jazz URL and failed startup.

### Sidebar icon alignment

- [x] Bundle updated DUI and align Drawer link/Details icons with right carets, full-width items and zero Details borders.
- [x] After implementation approval, add and run focused navigation alignment coverage.

### Responsive categories table

- [x] Use DUI Table for categories with a localized caption and contained horizontal scrolling.
- [x] After implementation approval, add and run focused narrow-screen category-table coverage.

### Category creation modal

- [x] Move category creation into DUI Dialog with a localized trigger/Cancel button and workspace dismissal.
- [x] After implementation approval, add and run focused modal creation, validation, dismissal/focus, draft retention and workspace-reset coverage.

### Page content spacing

- [x] Add shared PageContent with theme gap and use it in AppShell.
- [x] After implementation approval, verify page spacing and narrow-screen table containment.

### Tags table and creation modal

- [x] Match categories with a responsive tags table and Add tag modal, Cancel first and primary Add action.
- [x] After implementation approval, add and run focused tag modal and narrow-screen table coverage.

### Shared creation modal and transaction account setup

- [x] Share modal form presentation across account, category and tag creation.
- [x] Reuse scoped account creation in account pages and empty-account expense/income list/entry states, retaining owner/admin authorization.
  - Implementation ready for review. Svelte/application/service-worker static checks pass with zero errors or warnings; changed-file formatting and whitespace checks pass. Focused runtime coverage passed after implementation approval; see validation below.
- [x] After implementation approval, add and run focused modal, authorization, scope-change and account-to-transaction coverage.

### Sidebar account modal

- [x] Remove /accounts/new and open the shared account modal directly from the sidebar; keep field IDs unique across instances.
- [x] After implementation approval, update account-creation navigation coverage and verify sidebar dismissal/focus behavior.

### Creation modal and navigation validation

- [x] 79 focused unit tests pass across form/account-order/access machines and account/category/tag validation (including seven new account-creation access cases).
- [x] 17 focused browser scenarios pass across creation modals, workspace resets, first-account expense/income entry, responsive sidebar navigation/alignment, and the migrated finance smoke test.
- [x] Svelte/application/service-worker and browser-test TypeScript checks pass; formatting and whitespace checks pass.
  - Browser coverage verifies equal-width Cancel/Add controls and decorative icons, whitespace validation, Cancel/Escape/backdrop dismissal and focus restoration, retained drafts, add-another/reset, persistence, keyboard-scrolling narrow tables, page gap, sidebar modal activation without URL changes, and the removed route’s 404.
  - Fixed a measured 4px Cancel/Add width difference caused by DUI primary buttons omitting borders: shared controls now use equal border-box flex bases.
  - Tests used the local app at http://127.0.0.1:5173. Initial connection/setup failures were resolved by starting/restarting the dev server; static sync regenerates the public Jazz URL, so runtime verification followed a server restart. Narrowed reruns verified the fixes. This was focused validation, not the full repository browser suite; the remaining suite migration and its results are recorded below.

### Existing browser suite migration

- [x] Migrate account creation, authentication, account-order, permissions, workspace, UI and PWA tests to shared modals, Current workspace, Login and disclosed sidebar navigation. Keep only the intentional /accounts/new 404 assertion.
- [x] Add shared user-interaction helpers for disclosure navigation, creation dialogs and workspace switching; preserve security/persistence/offline assertions.
- [x] Update the old SimpleFIN permission fixture to a dummy encrypted envelope and empty legacy URL sentinel, without changing application policy.
- [x] Run the affected development and production-PWA suites, fix compatibility failures and record results.
  - Exercised all 106 affected development-browser cases: 104 pass; the two unchanged expense/income default-category assertions fail on switching back to the original workspace.
  - All six production-PWA cases pass after adding the public Banks shell to the cache allowlist. Combined affected-browser results: 110 pass, two fail.
  - Account archive admin replication timed out once under the parallel run and passed in an isolated rerun. Drawer geometry now waits for transition completion; offline status expectations match the compact Offline label.
  - Browser-test TypeScript, changed-file formatting/whitespace checks and the production build pass. No assertions were weakened to hide the category-default failures.

- [x] Investigate the existing expense/income default-category regression: both unchanged `default category ... survives overrides, reset, and workspace switching` scenarios pass on 2026-10-25. They save in the second workspace, switch back, reopen entry and assert the original system category. No application fix or weakened assertion was needed; see focused verification below.

### Expense and income list presentation migration

- [x] Adopt PageContent for transaction screen blocks and day groups.
- [x] Adopt DUI Heading/Text for transaction list content and shared Message feedback.
- [x] Share the repeated two-sided row layout and use DUI spacing tokens.
- [x] Review the presentation implementation.
- [x] After approval, update focused transaction-list browser coverage and run relevant checks.
  - All 319 unit tests and 21 selected browser scenarios pass across focused runs; browser-test TypeScript and whitespace checks pass. Browser coverage includes profile/avatar persistence, recovery, offline changes, owner authorization, transaction lists, locale formatting, responsive navigation and sidebar status.

### App shell component boundaries

- [x] Extract props-driven AppTopMenu and AppDrawer with their existing styles; preserve shell-owned responsive coordination and callbacks.
- [x] Review the component extraction. Revisited AppShell, AppTopMenu, AppDrawer and AppNavigationLink on 2026-10-25; responsive policy remains shell-owned and extracted presentation receives props/callbacks.
- [x] After implementation approval, run relevant navigation coverage and update it if needed. The 2026-10-25 focused navigation checks pass; see below.

- [x] Share drawer navigation links across top-level and Details sections using AppNavigationLink.
- [x] Review shared-link implementation before running relevant navigation tests. Exact current-page matching and workspace-scoped hrefs pass the 2026-10-25 focused check.

### Transaction pagination

- [x] Bundle and install local DUI with Pagination and PaginationItem.
- [x] Paginate the shared transaction list at 25 entries, preserving daily totals and filter resets, with localized accessible controls.
- [x] Review the pagination implementation. Revisited for the 2026-10-25 edge-case checks below.
- [x] After approval, add and run focused pagination unit and browser coverage for boundaries, date splits, filter resets, and shrinking results. Earlier verification covers boundaries/totals/filter resets; live shrinking-result coverage passes on 2026-10-25.

- [x] Add a development-only button for 25 persisted sample transactions per explicit click, with sequential write states and localized progress.
- [x] Review the sample creation implementation before adding or running its tests. Existing implementation reviewed; original machine coverage and new edge-case browser results are recorded below.

- [x] Keep pagination controls at a consistent slot count and omit truncation for five or fewer pages.
- [x] Review the pagination range adjustment before adding or running its tests. Covered by the recorded earlier range verification.

- [x] Drive transaction pagination from the URL `page` parameter with real links and filter reset behavior.
- [x] Review URL pagination before adding or running focused link, reload, history, invalid-page and filter-reset coverage. Earlier verification covers those scenarios; shrinking-result URL preservation now also passes.

- [x] Move development sample controls into a developer dialog with a focus-revealed opener at the top of every page.
- [x] Review developer menu before adding or running keyboard visibility, modal dismissal/focus, and batch-preservation coverage. Earlier focused verification and the 2026-10-25 source review supersede this historical gate.

- [x] Move the developer menu to the root layout with identical income/expense actions on every page; move sample actors/subscriptions out of TransactionView.
- [x] Review global developer menu before adding or running route availability, session-disabled controls and navigation-progress coverage. Earlier route/navigation checks plus the new held-startup disabled-control check cover this scope.

- [x] Encapsulate content, control context, development gating and sample session binding inside DeveloperMenu; simplify shared layout to one mount.
- [x] Review developer menu encapsulation before its focused checks. Revisited DeveloperMenu, its dialog/control presentation and SampleTransactions integration on 2026-10-25.

### Pagination and developer menu verification

- [x] User approved implementation testing.
- [x] Add sample-batch unit coverage: sequential writes, ignored duplicate clicks, complete/partial/failure outcomes, new-batch retry and cancellation with late completion.
- [x] Run focused unit checks: 8 passing tests across sample-transactions and transaction-groups.
- [x] Add and run 3 isolated browser scenarios: keyboard opener/Escape/Close focus, income and expense sample writes from the global menu, progress across client navigation and menu availability on Login; 25-row pages/full daily totals, five-slot truncation, URL parameter preservation/history/reload/invalid and out-of-range pages, account filter reset; five-page mobile controls without truncation.
- [x] Browser-test TypeScript and focused Prettier/whitespace checks pass.

Runtime logs include XState assign warnings and a SvelteKit replaceState deprecation warning. No production changes were made in this testing cycle. These focused scenarios do not establish offline behavior, startup-disabled controls, workspace replacement during an in-flight batch, or result-shrink races.

### Kind-scoped names and duplicate validation

- [x] Implement category duplicate-name guards and localized feedback (implementation approved; focused checks passed).
- [x] Share pure name normalization between category and account guards.
- [x] Observe active organization accounts and assess duplicate names after authorization before creation (implementation approved; focused checks passed).
- [x] Review category/account implementation, then add and run focused unit and Playwright coverage.
- **Superseded**: existing-tag migration policy preserving unlinked and mixed-kind history; the user selected required-kind alpha storage instead.
- [x] Add required kind for new tags, matching-kind categories, settings duplicate guards and legacy unassigned feedback (implementation approved; focused checks passed).
- [x] Update transaction tag selection, inline creation and ambiguity guards to match transaction kind (implementation approved; focused checks passed).
- [x] Review tag implementation, then add and run relevant unit and Playwright coverage.

- [x] Accept transitional null kinds for existing tags and retain historical links while excluding them from new assignment.
- [x] Generate and review the local additive tag-kind migration and snapshot; do not deploy.

### Duplicate-name and tag-kind verification

Implementation review was approved by the user's continuation. All 136 focused
unit tests pass across account creation, management, transaction entry, canonical
tag validation and persistence. New coverage checks normalized names, active versus
archived records, organization/kind boundaries, refreshed pre-write observations,
editable recovery after duplicate feedback, mismatched tag categories, untyped
legacy tags and transaction-time ambiguity.

All three isolated Playwright scenarios pass across focused runs using
`playwright.duplicate-names.config.ts` and the in-memory Jazz server at
http://127.0.0.1:5184: account duplicates across types and archived-name reuse
while offline with reload persistence; category/tag kind-scoped settings and
retained selections; matching-kind transaction suggestions, typed inline creation,
existing-tag reuse and preserved legacy history/links. Initial browser failures
were fixture/locator issues (the seeded Salary category, the shared Tags label,
and matching category text when counting tag names); no production changes were
needed during verification.

Application/service-worker and browser-test type checks, focused Prettier checks,
and whitespace checks pass. Existing XState assign warnings remain in browser logs.
The schema migration is prepared locally and remains undeployed. These checks do
not prove cross-device uniqueness or perform the deferred existing-tag migration.

### Transaction description

- [x] Add optional description through schema, validation, persistence, entry, list/details, imports, samples, and localization.
- [x] Prepare the local additive description migration (not deployed).
- [x] Obtain implementation review before adding or running tests.
- [x] After approval, add and run focused validation/persistence/import unit coverage and Playwright coverage for single-line description entry and separate memo details.

Description verification: 116 focused unit tests pass across transaction validation, persistence, import decisions, and date grouping. All four browser scenarios in `playwright.transaction-description.config.ts` pass for income/expense entry, single-line description, multiline memo, list/detail separation, and reload persistence. Application and browser-test type checks pass. The stale installed UI dependency was refreshed from the existing vendored archive. Existing XState assign warnings remain in browser logs. The additive migration remains local and undeployed.

Merge integration with editable transactions: preserve the editable details form, populate description in the edit adapter and initial values, include it in change detection, and save or clear it on updates. Verification: 149 focused unit tests and all four description browser scenarios pass, including description edits with memo preserved after reload. Application type checking passed during integration.

### Category and tag archive filters

- [x] Add localized default/archived/all radios to category and tag lists and include archived records in workspace subscriptions.
- [x] Obtain implementation review.
- [x] After approval, add and run focused coverage for default selection, archived-only/all filtering, live archive updates, and workspace isolation.

Verification: both focused Playwright scenarios pass in `tests/duplicate-names.e2e.ts` using the isolated in-memory Jazz configuration. Coverage includes both pages, native keyboard radio selection, alphabetical order, empty filtered results, live offline archiving in all/default views, retained archived records after reload, workspace isolation, and hiding the tag filter only when there are no tags. Browser-test TypeScript checks pass. Initial failures were test setup issues (startup dialog timing and empty-message capitalization), corrected without production changes. Existing XState assign warnings remain. No separate unit tests were added for this presentation-only change.

### Transaction list layout

- [x] Implement initially expanded date Details and rows with plain text, right-aligned amounts, and a single stretched chevron link.
- [x] Obtain implementation review.
- [x] After approval, add and run focused Playwright coverage for disclosure toggling and row navigation.

### Desktop transaction workspace

- [x] Move transaction routes into a shared route group, with income at `/income` and details under `/income/[id]` or `/expenses/[id]`.
- [x] Compose the existing list integration in an initially open desktop right Drawer and keep the center empty on index routes.
- [x] Preserve mobile page separation, center form ownership across viewport changes, and drawer pagination in selection/creation links.
- [x] Reuse delightful-ui Drawer and the shared viewport breakpoint, with localized close/reopen controls.
- [x] Obtain implementation review.
- [x] After approval, add and run focused Playwright coverage for drawer default/close/reopen, income/expense selection, pagination, direct links, mobile routing, and unsaved form preservation across resizing.

Implementation reviewed and testing authorized by the user. Focused Prettier and whitespace checks pass. The full application check remains blocked by the existing DeveloperMenu.svelte optional browserOrigin type error; browser-test TypeScript checks pass.

Route revision: income navigation and creation now use `/income` and `/income/new`; detail links use `/income/[id]` and `/expenses/[id]`. The URL selects the drawer kind directly, removing the layout’s redundant record subscription and remembered-kind state.

### Return to list after creation

- [x] Navigate successful income/expense creation to the section index using the machine’s succeeded result, replacing the `/new` history entry.
- [x] Obtain implementation review.
- [x] After approval, verify income/expense creation navigation on desktop and mobile, including remaining on the form when validation or persistence fails.

- [x] Keep creation fields visible through successful navigation and suppress the intermediate success/add-another presentation.
- [x] After implementation approval, include absence of the intermediate success screen in creation navigation coverage.

### Machine-owned creation navigation

- [x] Replace component success effects and visibility flags with an invoked completion workflow after persisted, same-scope success.
- [x] Model navigation pending, completed, and failed states; retry only navigation without repeating the write.
- [x] Keep the disabled form visible through navigation and availability refreshes; handle scope invalidation and shutdown before late completion.
- [x] Obtain implementation review.
- [x] After approval, add/run focused scoped-form unit coverage for success routing, navigation failure/retry without duplicate writes, scope invalidation, shutdown, and unchanged non-navigation form behavior; update the relevant creation browser coverage.

Verification: 56 focused unit tests pass in `scoped-form.test.ts`, `scoped-form-completion.test.ts`, and `transaction-entry.test.ts`. Coverage includes navigation after accepted local persistence, the income/expense destinations, retained disabled fields without an intermediate success screen, retrying failed navigation without another write, same-scope readiness refreshes, cancellation, scope changes, shutdown, ignored late results, and unchanged forms without completion configured.

All 15 focused browser scenarios pass across the suite and targeted reruns using `playwright.transaction-workspace.config.ts` on disposable in-memory Jazz at port 5181: five workspace scenarios, six existing edit scenarios, and four first-account/creation scenarios. Coverage includes desktop/mobile income and expense creation, native validation, offline writes and redirect, absence of the success-screen flash, replacement of `/new` in browser history, retained form input across resizing, drawer close/reopen and Escape focus return, date disclosure, one link per row, row hover colors, pagination through selection/creation/reload, kind-specific detail URLs, repeated edits, archived tags, check details, and read-only transactions. Browser testing exposed a disconnected opener; it now remains mounted and hidden while the drawer is open so focus can return correctly. The creation adapter uses SvelteKit's current `replace` option. Focused formatting/whitespace and browser-test TypeScript checks pass. Existing XState assign warnings remain in browser logs. The unrelated DeveloperMenu optional-property type error still prevents a clean full application check. The user's persistent development environment was not used or cleared.

- [x] Add a localized Cancel button to income and expense creation, returning to Overview without form submission; implementation approved for testing.
- [x] After implementation approval, add/run focused browser coverage for Cancel on both creation routes, including invalid drafts.

Cancel/primary Save verification: all 12 focused Playwright scenarios pass (eight Cancel cases covering valid/invalid income/expense drafts on desktop/mobile, plus four existing offline creation/edit regressions). Cancel returns to Overview without saving; Save uses the primary style in create/edit mode. Browser-test TypeScript, focused Prettier and whitespace checks pass. Existing XState assign warnings remain.

- [x] Extract a reusable avatar display and show existing creator/editor profile avatars beside transaction attribution names; prefill the DUI profile avatar input and preserve name fallbacks.
- [x] After implementation review, add/run focused avatar display and transaction attribution coverage (missing/broken/replaced images and object URL cleanup). The 2026-10-25 transaction polish checks below pass.

- [x] Add native transaction content slide-in through SvelteKit onNavigate (300ms ease-out, full viewport from the left, no fade), with stationary navigation/desktop drawer, reduced-motion/unsupported-browser fallbacks and unchanged-path/outside-route exclusions; current animation confirmed by the user on 2026-10-25.
- [x] After implementation approval, add/run focused transaction navigation coverage for list/new/detail and history navigation, reduced motion, unsupported API, skipped captures, and unchanged-path/outside-route exclusions. The 2026-10-25 transaction polish checks below pass; the user confirmed the current animation and the spec was corrected on 2026-10-25.

- [x] Put transaction attribution and timestamps in a Metadata Details disclosure closed by default; implementation approved for testing.
- [x] Add a localized mobile Back to list link on income and expense detail pages, preserving URL pagination; awaiting implementation review.
- [x] After implementation approval, add/run focused coverage for mobile detail back links, matching section and pagination, and absence on desktop and creation pages. Both income/expense scenarios pass on 2026-10-25.
- [x] Verify desktop/mobile disclosure defaults, pointer/keyboard toggling, visible editable form and retained drafts, timestamps, and closed-on-reload behavior. All eight transaction-edit Playwright scenarios pass, including six existing edit regressions; browser-test TypeScript, focused formatting and whitespace checks pass.

## Permission integrity follow-up

- [x] Tighten Jazz tag insert/update and transaction-tag assignment rules. The later required-kind alpha policy removes untyped legacy compatibility; kinds/workspaces remain immutable and assignments must be compatible.
- [x] Historical implementation: require a payment method for manual income. Superseded by the approved independent-Check contract: both income and expense may omit payment method, with Check/reference pairing enforced at the Jazz boundary.
- [x] Review the permission implementation (approved by the user’s “continue”).
- [x] After approval, add/run focused permission coverage for valid and mismatched tag/category organizations and kinds, missing kinds, legacy archive/removal, kind-change bypasses, manual missing-method rejection, imported missing-method acceptance and check-details enforcement.

Verification: `pnpm test:unit --run src/lib/permissions.test.ts` passes all 11
permission tests against the SDK’s temporary local authority, including seeded
legacy history. `pnpm test:permissions` passes all 32 browser scenarios (30 existing
and two new income/expense integrity cases) against disposable in-memory Jazz on
port 5180. Existing tag fixtures now specify their required kind. `pnpm check`,
`pnpm check:tests`, focused Prettier and `git diff --check` pass. No production
changes were needed during verification; nothing was deployed or committed.

## SimpleFIN documentation reconciliation

- [x] Align MVP SimpleFIN requirements, architecture, credential-access assumptions and obsolete backlog entries with constitution VI and spec 002.
- [x] Review this documentation reconciliation through the subsequent implementation/test cycle; sync-indicator, merge and sharing features remain outside the approved repair scope.

## Required tag kind in alpha storage

- [x] Require tag kind in storage and remove the untyped-tag permission exception.
- [x] Replace the legacy migration proposal with the user-approved required-kind alpha policy in the design and plan.
- [x] Review this schema/permission implementation (user approved with “continue”).
- [x] After approval, update fixtures and verify direct SDK inserts/updates and assignments for expense/income, missing/null kinds, optional/mismatched/foreign categories, immutable kinds/workspaces, archived typed history, and cross-workspace assignment rejection.
- [ ] Handle an existing environment’s schema/data transition separately before deployment; no reset is performed here.

Verification: 177 focused tests and four focused browser scenarios pass; the
12 SDK authority tests also pass separately. Application/service-worker and
browser-test type checks pass. See [tag-kinds.md](tag-kinds.md#required-kind-verification)
for scope, fixture updates, and limits. No data reset or deployment performed.

## Remove the unrequested amount ceiling

- [x] Remove the signed-32-bit amount ceiling and parse decimal digits exactly before safe Number conversion; align the money requirement and plan.
- [x] Identify the actual signed-32-bit SDK storage restriction through direct-write tests and change transaction amount storage to bigint with a validated Number adapter.
- [x] Review the original parser implementation (user approved implementation/verification).
- [x] Review the additional bigint storage change discovered necessary during SDK verification (user approved with “continue”).
- [x] Replace obsolete ceiling expectations and verify above-old-limit entry, exact safe-integer boundaries, no rounded acceptance, and direct SDK persistence above the old limit.

Verification after bigint storage approval: all 94 focused tests pass across
money parsing/formatting, transaction validation and the real SDK permission
authority. Both 2,147,483,648 and Number.MAX_SAFE_INTEGER minor units persist
without truncation and read back through a remote-confirmed SDK query. The
focused Playwright amount-entry scenario passes on disposable in-memory Jazz at
port 5180: save/reload above the old limit, exact maximum cents, and rejection
one cent beyond the safe-integer boundary without changing the saved amount.
Application/service-worker and browser-test type checks, focused formatting and
whitespace checks pass. No schema deployment, reset or commit performed.

## Imported transaction editing

- [x] Record imported editing requirements and the existing-machine ownership/guard model.
- [x] Implement observed provenance in validation, imported readiness/persistence support and immutable provenance at the Jazz boundary.
- [x] Review the implementation before tests (user approved with “do tests”).
- [x] After approval, verify imported expense/income edits, categories/tags/notes and other editable fields, absent payment-method retention, provenance spoof/change rejection, pristine/reverted drafts, repeat-import preservation and existing manual/check/offline/access behavior.

Imported editing verification: all 178 focused unit/SDK tests pass across form
validation, edit readiness, edit persistence, permissions and provider import
decisions. The eight existing transaction-edit browser cases passed in the initial
run; both new imported income/expense cases passed in a focused rerun after test
locator corrections. The updated bank connection/manual-sync scenario also passes
and confirms repeat sync retains user description/memo/amount and exactly two
provider rows. All browser work used disposable in-memory Jazz on port 5180.
Application/service-worker and browser-test type checks, focused formatting and
whitespace checks pass. No production fixes were needed during verification.
No commits, existing-data resets or schema deployments performed.

## Spec/code reconciliation status (2026-10-24)

- [x] Complete the two permission fixes, require tag kind without untyped legacy exceptions, remove the unrequested amount ceiling, and support imported transaction editing.
- [x] Complete the approved independent-Check implementation and the recorded unit/browser verification; see [009-independent-checks/tasks.md](../009-independent-checks/tasks.md) for exact coverage and remaining verification.
- [x] Reconcile SimpleFIN documentation with constitution VI and spec 002. This documentation task does not implement the separately deferred features.
- [x] Close the composed coordinator and account-move authorization verification gaps in feature 009. The follow-up adds 49 cases and passes all 84 focused coordinator/resource/SDK authority tests; no production changes were needed. This is additional focused verification, not a new full-suite/browser run.
- [ ] Apply the required-kind/Check schema changes to an existing environment only after separate authorization. Legacy tag migration is superseded by the alpha-data policy; no reset has been performed.

Latest verification for this implementation: all 1,023 unit tests pass across 74
files. All 25 transaction edit/workspace browser cases have passing results across
focused runs, including corrected stale expectations and a readiness retry.
Application/service-worker checks, browser-test TypeScript, changed-test formatting,
and whitespace checks pass. This does not supersede unrelated historical browser
suite failures or establish CI readiness.

The user explicitly excluded partial/unimplemented features from this repair cycle.
The remaining feature backlog includes whole-device Jazz sync observability,
account merging (feature 002), business/invite/grant-management UI, transaction
attachments and batches/templates, broader responsive/accessibility and PWA/access
review, CI, physical-device passkey/replication validation, multi-currency/FX, and
native wrappers. Feature 009 separately defers written-check controls and exclusive
assignment/shared-reference handling. Earlier review checkboxes in this chronological
file are historical; completed later verification supersedes their corresponding
review/test gates, not these outstanding feature or verification items.

## Resolved: Older UI review notes and default-category regression (2026-10-25)

The user requested this verification after reviewing the existing implementation.
Source review covered AppShell, AppTopMenu, AppDrawer, AppNavigationLink and
transaction default-category rendering. Existing default-category fixtures and
assertions were inspected before execution and left unchanged.

Nine scenarios pass across focused runs: both expense/income category-default
regressions; four drawer startup/navigation viewport cases (390, 768, 769, 1280px);
resize/disclosure navigation; new mobile full-width push/overflow/inertness/dismissal/
focus coverage; and new Accounts/Settings disclosure, exact current-page and
workspace-scoped shared-link coverage. The new mobile test checks 390px content
width and a 334px pushed position, no document horizontal overflow, desktop/mobile
inertness changes without changing disclosure, and dismissal focus restoration.
The Settings test checks initially closed disclosures, a single exact active link,
workspace navigation and Account/Login href scope. Its first attempt incorrectly
scoped Login inside Settings; source/snapshot inspection confirmed Login is a
top-level link, the locator was corrected, and only that failed scenario was rerun.

Browser-test TypeScript passes. All browser checks used the same known disposable
in-memory agent server at http://127.0.0.1:5185. Initial sandbox listener/connection
restrictions were environment failures; testing proceeded with authorized access.
No application code changed, no hosted records were accessed, and the user's
persistent development server/storage was untouched. This does not close Sync now
mobile dismissal, all T059 default-account permutations, the deferred broader
responsive/accessibility audit, or unrelated browser/CI gaps.

## Resolved: Pagination/developer-menu edge cases (2026-10-25)

Inspected TransactionList/TransactionView pagination, DeveloperMenu and its pure
dialog/controls, SampleTransactions integration and the batch-machine tests before
adding focused coverage to tests/pagination.e2e.ts. The existing implementation was
already reviewed and the user explicitly requested verification of this scope.

All four new Playwright scenarios pass across focused runs:

- Hold WASM startup; both sample-kind controls remain disabled while the runtime
  is unavailable, and startup proceeds when the hold is released.
- Save 25 samples while offline after the destination route is ready; assert local
  list visibility, reconnect, confirm all 25 through a remote-tier query, then reload.
- Shrink 76 results while page 4 is requested to 26, 25 and zero; assert clamped
  current page, entry counts, recalculated full daily totals, pagination removal,
  and preservation of the requested URL during subscription updates.
- Pause the first sample write's settlement, switch to a second authorized
  workspace, release settlement, and assert the partial outcome and enabled
  control. A remote-tier query confirms exactly one original-workspace transaction
  and zero replacement-workspace transactions; no subsequent sample is retargeted.

The first offline attempt disconnected before client navigation finished and hit
an unloaded development route. The test now explicitly waits for the Expenses
heading before disconnecting; only that scenario was rerun and it passes. The
other three passed on their first run. The database wait wrapper is test-only and
is released/restored in finally. No application code or hosted data changed.
All browser checks reused the disposable in-memory agent server at
http://127.0.0.1:5185. Broader browser/CI status and physical-device offline support
are not established by these checks.

## Resolved: Attribution avatar rendering and object-URL cleanup (2026-10-25)

The user explicitly authorized completing the remaining verification together.
Inspected Avatar, TransactionDetails, TransactionEditEntry, ProfileAvatarForm and
existing profile/avatar tests before adding tests/transaction-polish.e2e.ts.
The focused attribution scenario passes for missing avatar/name identity fallbacks;
decorative creator/editor images that decode; live replacement and revoked old
URLs; undecodable-image fallback with retained names; cleanup after missing data;
and cleanup when navigating away. Account settings show the saved avatar preview,
allow selecting and clearing an unsaved replacement back to the saved preview,
and expose exactly one saved-avatar removal action. Removal clears the image and
revokes its preview URL without changing the display name. Failed-image URLs are
also verified revoked when data is removed.

The expanded scenario's synthetic canvas fixture initially lacked a rendering
context. That fixture was corrected before rerunning the one scenario, which
passes. No production fix was needed.

## Resolved: Transaction routing transitions and mobile back links within tested scope (2026-10-25)

Seven other scenarios pass across focused runs: income and expense mobile detail
Back to List links retain the workspace and page=2, reach the matching section's
second page and are absent on index/creation and desktop detail pages; native
transitions occur on list/new/detail path changes and browser Back/Forward; they
do not occur on query/hash-only changes or navigation outside transaction routes;
and navigation completes with reduced motion, unavailable APIs, skipped captures
and rejected update-callback promises.

The history scenario initially issued Forward before Back had finished rendering;
it now waits for the list and absence of the detail form, preserving all transition
count assertions. The one corrected scenario passes. Rejection/skip adapters are
test-only; normal routing coverage wraps the real browser transition API.

- [x] Resolved: Animation style alignment. The user confirmed that the spec was wrong; it now matches the existing translateX(-100vw) slide from the left over 300ms with ease-out timing and no fade. No application styling changed, and this documentation correction does not claim additional visual testing.

All eight transaction-polish scenarios have passing results across the focused
runs, including the final expanded avatar test. These are not a combined full-suite
run. Tests reused the disposable in-memory agent server at
http://127.0.0.1:5185. No application code, hosted data or user browser storage changed.

## Resolved: Remaining automated readiness checks (2026-10-25)

The user authorized all remaining automated verification. Hosted recovery in a
separate empty-storage browser retrieves the retained sample identity's account,
exact bigint expense and independent Check, establishing server persistence beyond
same-browser reload. Recovery phrases were kept private.

Ten new offline-access browser scenarios pass across owner/admin/member/viewer,
selected/all/no grants and no-membership/orphan-grant cases. Offline local query
results match warmed authorized online results, read-only UI remains disabled,
and authorized offline edits are confirmed through owner remote reads after
reconnection. This is not an offline revocation/erasure guarantee. Existing CI
permission cases separately cover direct-write denials.

All ten production PWA scenarios pass against a build using the disposable agent
backend and preview at http://127.0.0.1:4176. Worker fixtures restore generated
bytes. The cache assertion derives the expected origin from page.url() so it can
use a separate preview port without changing its same-origin security invariant.
Chromium diagnostics report no manifest parsing or installability errors. Device
prompt presentation/install/OS integration remain manual.

Application/service-worker checks, browser-test TypeScript and the build pass.
Current unit verification totals 1,079 passing tests across 74 files: 1,020 pass
in the initial run; sandbox listener restrictions prevent two authority suites
from starting, then those 59 cases pass under authorized listener access. No
production defect was found and no app code changed.

GitHub Actions run 40182572033 on this branch at 6243f75 has all six jobs successful:
application, authentication, permissions and workspace browser suites, production
PWA, and types/unit/build. Historical broader browser/CI failure notes are resolved
for that revision, not evidence against the current branch. Local uncommitted
verification additions still require their own future CI run after commit/push.

- [x] Resolved: Automated combined offline/access matrix and production PWA/update verification.
- [x] Resolved: Hosted recovery from an empty-storage independent browser context.
- [x] Resolved: Successful GitHub-hosted checks and broad browser suite evidence for 6243f75.
- [ ] Review passkeys, credential unlock/replication and native installation/prompt/installed-app behavior on actual intended devices. Synthetic/browser automation does not close those checks.

### Drawer panel border API review cycle

- [x] Add and document the public Drawer panel end-border token, package it locally, and replace Finance's private panel-border selector.
- [x] Review the library and Finance implementation before executing affected browser tests.
- [x] After approval, inspect and run focused Drawer/navigation/layout coverage, including a public-token geometry check for the separator.

### Details styling API review cycle

- [x] Add/document the four Details styling tokens, package locally, and replace Finance's private caret/content selectors.
- [x] Review the library and Finance implementation before executing affected tests.
- [x] After approval, inspect and validate Details disclosure behavior, sidebar spacing, transaction group summaries and caret geometry.

### Icon and top-menu styling review cycle

- [x] Consolidate navigation icon styling in AppIcon and simplify AppTopMenu's global rules using existing native tokens/attributes.
- [x] Review the four-component implementation before executing affected tests (remaining implementation and tests authorized together).
- [x] After approval, inspect and validate icon alignment, responsive navigation, header/logo geometry and drawer offsets.

### Complete native CSS cleanup and validation

- [x] Convert remaining form and view-transition selectors to readable native global blocks and document intentional styling boundaries.
- [x] Inspect/update affected browser assertions for navigation/header/icon geometry, form controls and motion preferences.
- [x] Run focused Finance and library browser coverage, static checks and changed-file formatting/whitespace checks; record outcomes.

Final styling verification: 17 focused Finance scenarios and all 15 Drawer/Details
library scenarios pass. The icon alignment scenario also passes after removing
obsolete icon classes and replacing its locator with a semantic one. Application,
service-worker, browser-test and library static checks pass; changed-file
formatting and whitespace checks pass. No domain/workflow logic changed, so no
new unit-test coverage is required for this CSS-only batch. Five intentional
global blocks remain and no parenthesized global selectors remain in Finance.

Permanent test scope after review: removed all seven new styling-validation
scenarios, extra geometry/color assertions and the development-only Details story.
The executed results above remain historical development evidence. Existing
behavior tests remain unchanged except the semantic icon-locator update required
by removing its old styling class. No new permanent test cases remain.

### Simple selector cleanup review cycle

- [x] Simplify the four presentation components, package DUI locally and complete static/formatting checks.
- [ ] Review implementation before running existing status-message, navigation, overview and transaction-workspace behavior coverage.

### Details content snippet review cycle

- [x] Replace the four layout-specific Details tokens with a default/replacement content snippet, preserve the absolute frame, and adopt consumer-owned content/caret layout in Finance.
- [x] Audit both repositories for other composition opportunities and record findings without adding unused APIs.
- [ ] Review the focused implementation and then validate default/custom disclosure, keyboard behavior, absolute placement and Finance navigation/grouping using behavior coverage.

### DUI feedback/control composition review cycle

- [x] Implement/document the four requested optional snippet APIs and retain existing defaults and accessibility ownership.
- [ ] Review implementation, then validate default/replacement feedback, step labels and close controls with focused semantic/behavior coverage.

### Typography and Button review cycle

- [x] Commit and push the preceding Finance/DUI composition and styling work on feature branches.
- [x] Simplify Text/Heading selectors with a genuinely shared token lookup and consolidate Button variant interaction styling.
- [x] Review the new implementation before typography/Button behavior validation; inspect existing stories and fix stale story identifiers before tests.

Typography/Button verification: all 13 existing semantic unit tests, five Button
browser scenarios and 11 focused Finance browser scenarios pass. Temporary
before/after inspection covered 69 component pairs and 258 observations across
light/dark themes, size/alignment defaults, public and inline overrides, nested
alignment and enabled/native-disabled/ARIA-disabled/fieldset-disabled Button
states; no differences were observed. Temporary fixtures were removed. The only
permanent test edit corrects the stale flat-secondary story identifier. No new
style-only tests were retained. Library/application static, browser-test TypeScript,
changed-file formatting and whitespace checks pass.

### Viewport shell and shared drawer sections review cycle

- [x] Extract AppDrawerContentSection and reuse it for filters, workspace selection and the navigation footer.
- [x] Apply the user-edited viewport grid, main scrolling, direct route/dialog content and sticky transaction creation action; remove unused header measurement.
- [x] Review implementation and align browser assertions with removed wrappers and shared footer padding.
- [x] Complete focused static, formatting, rendering-unit and browser validation; record results.

Earlier PageContent adoption entries describe historical work; the viewport shell
change above supersedes that component and its shared spacing contract.

Validation: changed-file Prettier and whitespace checks pass. Application/service-worker
and browser-test TypeScript checks pass with zero Svelte errors or warnings. All nine
rendering unit tests pass. Across creation modals, navigation, overview, transaction
workspace and UI integration, 41 browser scenarios passed initially; the tag scenario
stopped at the obsolete PageContent 15px-gap assertion. After replacing that with a
non-overlap assertion, both category/tag scenarios pass, completing all 42 scenarios.
Browser validation used a disposable in-memory Jazz server and isolated temporary
environment settings on app port 5182. No standalone lint script is configured;
Svelte and TypeScript checks supply the available static validation.

### Finance presentation extraction — complete

- [x] Extract/adopt NavigationLink, NavigationGroup and DrawerSection (DUI #9 / Finance #47 merged).
- [x] Extract/adopt LoadingContent (DUI #10 / Finance #48 merged).
- [x] Extract/adopt LinkedListRow (DUI #11 / Finance #49 merged).
- [x] Extract separate native FloatingActionLink and FloatingActionButton; adopt the link in Finance (DUI #12 / Finance #50 merged).
- [x] Complete focused checks and rendering/browser validation for each adoption; record evidence in docs/delightful-ui-integration.md.
- [x] Close the extraction batch following user review; leave SplitRow, legends and image editing in Finance pending a concrete reuse need.

These entries close this extraction batch only. Earlier unrelated unchecked review/verification
tasks retain their existing status; the previously skipped app-specific candidate remains excluded.
