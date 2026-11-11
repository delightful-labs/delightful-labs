# Opt-in fake data for empty applications

## Local-first revision pending

This document records the prior seeding design and its historical verification. [013](../013-local-first-startup/spec.md), FR-004, requires optional seeding to run independently of ordinary local readiness, including when remote emptiness confirmation or exclusive acceptance waits indefinitely. T006 owns that pending change. Preserve authoritative emptiness checks, owner authorization, stable IDs, exclusive seed acceptance, and cancellation/resource cleanup; local absence alone must never authorize seeding. Earlier verification below does not establish this new readiness behavior.

## Requirements and design

`PUBLIC_FAKE_DATA=true` enables automatic finance data seeding independently of `PUBLIC_DEBUG`.
It defaults to false in the application configuration. At the user's request, Netlify TOML explicitly
enables it for Deploy Previews. Local development can opt in through an environment file. To test an
empty preview, change its TOML context to false and rebuild; the TOML value overrides the Netlify UI.
Debugging may be enabled without seeding, or seeding without debugging. Keep this work on
`feature/environment-debug-logging` and the existing PR.

After normal workspace initialization, seed the signed-in owner's initial workspace only when no
visible accounts or transactions exist anywhere in the app. Starter categories, memberships and
profiles do not count as finance data. Check local data first so ordinary populated offline use
does not need another network read. An empty local cache never authorizes writes: confirm emptiness
through authoritative remote reads and recheck it inside an exclusive Jazz transaction. Do not seed
an organization the user does not own. Use the workspace's existing categories and USD accounts.

Generate three accounts (cash, bank, card) and 120 manual transactions across the last 90 days,
including income and expenses with integer minor-unit amounts. Use English Faker finance strings
for account names and transaction descriptions; they are persisted fake content, not UI copy.
Use stable workspace-namespaced UUIDs for inserted rows and a single exclusive commit, confirmed by
the server. This prevents refresh duplication and keeps concurrent seeding atomic. Do not add a new
schema, marker table or browser flag. Deleting all finance data makes the app eligible again while
the flag remains on. Never fetch real provider transactions or change existing finance records.

## Mandatory machine-first gate

This is a resource-owning workflow, not one promise actor or an async transaction callback:

`readingLocal -> readingAuthority -> preparing -> opening -> rechecking -> staging -> committing
-> settling -> succeeded`

- Guards route populated/foreign-owned workspaces to `skipped` before writes.
- The machine owns one exclusive transaction through read/check/write/commit/confirmation.
- Errors after acquisition roll back; rollback failure is explicitly unresolved.
- Parallel control states `active`, `cancelling`, `closing` preserve pending acquisitions/operations
  until they settle. Check interruption before staging and before commit. After commit, await actual
  confirmation; do not claim cancellation undid a confirmed write.
- Success, skip, failure, cancellation and shutdown are terminal states. Context holds records,
  generated payloads, resource handles and the terminal result, not lifecycle flags.
- A separate `workspace-fake-data.ts` actor owns the environment gate, invokes the seed transaction
  child, forwards cancellation/shutdown until cleanup finishes, and translates outcomes to the
  initialization contract. Workspace initialization only invokes that adapter and handles its result. Existing actor inspection automatically observes the child.
- Leaf actors perform one related read set, pure payload/ID preparation, transaction acquisition,
  unconditional insert staging, commit, confirmation or rollback. Reuse `jazz-transaction-actors`.

The automatic seed actor imports its payload generator on demand. The developer controls load the
shared English Faker generator during initialization so the explicit 25-transaction action also
works after going offline. Its existing batch machine remains unchanged. Remove only the
persisted sample-content Paraglide key (`labels.sample_subject_number`); keep developer menu UI
labels and status messages localized. No new presentation components or styling are needed.

This related change needs more than six files: env, generator, transaction machine, initialization
and startup types, sample component, dependency manifests, the one localization key and
documentation. That scope was discussed before implementation. It does not broaden into other
startup or persistence refactors.

## Review and verification

- [x] Implement the independent flag, shared English Faker generator and seed workflow.
- [x] Wire initialization and the developer menu; remove the obsolete persisted sample label.
- [x] User approved tests after reviewing the extracted child actor.
- [x] Update workspace-startup/initialization DB fixtures for the exclusive transaction API and
      replace old sample-description text assertions with transaction-link counts before execution.
- [x] Verify flags independently; existing data/partial data skip; empty authoritative state seeds;
      refresh and concurrent clients do not duplicate; owner and category checks; rollback, commit
      rejection, cancellation/shutdown and late completion behavior.
- [x] Browser checks: empty seed enabled, reload unchanged, seed disabled empty, debug disabled seed
      enabled, manual 25-transaction action still works with generated descriptions.

Sources: [Faker usage](https://fakerjs.dev/guide/usage.html),
[Faker finance API](https://fakerjs.dev/api/finance.html). Installed Jazz alpha.59 exposes
`beginExclusiveTransaction()` and `ExclusiveWriteHandle.wait()` for authority-confirmed writes.

Implementation review: the four related read sets and payload preparation are leaf actors; all
eligibility, recheck, staging, commit, confirmation and rollback decisions are visible in the seed
statechart. No promise body reads/checks/writes as a hidden workflow. Before acquisition, cancellation
may discard passive read/pure preparation results: the SDK exposes no per-query AbortSignal and the
session owns those reads. Late results cannot advance the retired actor. After acquisition, the
parallel control region retains the transaction operation until it can roll back or confirm the
commit. The initialization parent preserves a confirmed seed's settlement when cancellation arrives
after commit. Final states release record, plan and transaction references.

Verification: 75 focused unit/integration cases passed across eight files, including real Jazz
permission enforcement and concurrent seed attempts. The full application and test type checks,
Paraglide compilation, formatting/diff checks and a production build passed. Eleven browser cases
passed: all four combinations of fake-data/debug flags, four existing manual sample regressions,
and three production smoke cases against the previously created disposable Jazz Cloud app.

Browser verification confirmed 3 accounts/120 transactions, unchanged IDs and counts on reload,
independent debug-menu visibility, and 145 transactions after a manual batch followed by reload.
Manual saving still works offline and synchronizes after reconnect; workspace replacement still
drains the issued sample. The production test fixture initially opened its menu before startup
navigation finished; it now waits for the ready Accounts page, and the focused rerun passed.

All runtime checks used the isolated checkout with its own dependencies/generated files. Faker was
also installed in the main checkout with lifecycle scripts disabled after testing. The existing
development public environment file was byte-for-byte unchanged. No user development data was
cleared or reset, and the running development server was not stopped.

Review refinement: at the user's request, the flag gate and seed-result/settlement translation now
live in `workspace-fake-data.ts`. `workspace-initialization.ts` has one ordinary child invocation,
scope input binding, event forwarding and generic completion/error handling. The adapter composes
`fakeDataSetup` directly; no promise wrapper or hidden orchestration was added. The adapter's disabled path, independent flag combinations, failures and confirmed settlement
translation are covered by `workspace-fake-data.test.ts`.

Test entry points: `playwright.fake-data.config.ts` selects the dedicated seed checks on disposable
ports 5186/5187, with `PUBLIC_FAKE_DATA` and `PUBLIC_DEBUG` supplied explicitly. The default application
Playwright configuration excludes that dedicated matrix file. Hosted production checks opt in using
`PUBLIC_DEBUG=true PUBLIC_FAKE_DATA=true DEBUG_PRODUCTION_SMOKE=true
JAZZ_HOSTED_PREVIEW_SMOKE=true pnpm exec playwright test --config playwright.debug.config.ts` after
building with those public flags and a disposable hosted app's connection settings.
