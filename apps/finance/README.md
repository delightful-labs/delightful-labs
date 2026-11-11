# Delightful Finance

Delightful Finance is a local-first personal finance app using Jazz, Svelte 5, and SvelteKit 3.

## Pull request titles

Use [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for pull request titles: `<type>[optional scope][!]: <description>`.

Examples: `feat(details): animate opening and closing`, `fix: restore keyboard focus`, and `docs: clarify setup`. Use `!` for a breaking change and explain the change in the PR description. Choose a title that describes the complete change being merged.

The `Conventional PR title` GitHub Actions check validates titles when a PR is opened, edited, reopened, updated with commits, or marked ready for review. The `Conventional PR titles` repository ruleset requires this check before merging into `main`.

## Development

Use Node 24 and pnpm 10.22.0. `pnpm check` checks application and service-worker types;
`pnpm build` produces the production app and native service worker.

`pnpm dev` serves the app at `http://localhost:5173`, binding to the network, and serves Jazz at
`/jazz` on that same origin. Its alpha.60 SQLite store is `.jazz/alpha60/finance`. An occupied
port causes startup to fail. Keep the same browser profile and hostname: `localhost` and
`127.0.0.1` have separate browser storage.

Agents use `pnpm dev:agent` at `http://localhost:5180`, or choose another port with
`pnpm dev:agent --port 5181`. Agent Jazz data is in memory and disposable. Concurrent verification
that regenerates SvelteKit files needs a separate checkout with its own dependencies and generated
files. Keep the user's persistent server and storage untouched.

Development and Vercel builds use the same-origin Jazz endpoint automatically. For a local production
preview, build with `PUBLIC_JAZZ_SERVER_URL=same-origin`; start the preview with
`FINANCE_EPHEMERAL_JAZZ=true` only when disposable test data is intended.

## Vercel deployment

`vercel.json` selects SvelteKit, the frozen pnpm lockfile, and `pnpm build`. The Vercel adapter
uses Node 24 in `iad1`. `/jazz` exposes Jazz's supported backend handler with local-first guest
admission; backend credentials stay server-side. Production does not need Jazz Cloud provisioning
or a separate schema-deployment command.

Jazz's Vercel store manages a Sandbox with one vCPU, a persistent Drive capped at 1 GiB, and SQLite
blob storage. It requests hibernation after 60 seconds of inactivity. The Drive retains the database
across Sandbox stops. Production has its own stable core; Git-based previews use separate branch
cores. A CLI preview without Git metadata must provide a distinct `FINANCE_JAZZ_CORE_NAME` for that
preview. Never give a preview the production core's name. Keep browser tabs closed when unused and
monitor the Vercel plan's Sandbox allocation.

The alpha.60 target is a fresh database. Export and preserve an existing Finance backup before
moving data, then use Restore Workspace on the new target and save the new account's recovery
phrase privately. This does not perform an in-place alpha.59 database upgrade. Genuine alpha.59 v1
and v2 backup fixtures verify restored financial fields, relationships, attachment bytes, and retained
source history. Backup validation remains enforced, including transfer amounts and currencies.

The original Netlify deployment is retained as a rollback artifact with new builds paused. Legacy
migrations, schema snapshots and Netlify/Jazz Cloud scripts are preserved under
[`archive/jazz-alpha59`](archive/jazz-alpha59/README.md), outside the active source and deployment paths.
The archive keeps their original alpha.59 contents; it is not executed by the current SDK. Future
alpha.60 schema changes need migrations from the new database's actual baseline.
Restore the existing Netlify artifact and its saved DNS route for hosting rollback; do not rebuild it
from this SDK migration branch or use the archived migration chain as a data rollback mechanism.

## Fake data

Set `PUBLIC_FAKE_DATA=true` to fill an empty app with three fake accounts and 120 income/expense
transactions from the last 90 days. This flag defaults to `false` independently of `PUBLIC_DEBUG`.
Set it in `.env.local` and restart development, or as a build-scoped Vercel preview environment
variable and rebuild. Vercel previews do not enable sample data automatically.

Startup seeds only the signed-in owner's initial workspace when there are no visible accounts or
transactions, including archived data. Populated apps are left untouched. An authoritative read and
a serializable transaction guard empty-data eligibility; stable IDs and one confirmed commit prevent
refresh duplication. Clearing all finance data makes the app eligible again while the flag is on.
Faker generates persisted record names/descriptions; developer-menu labels remain localized. The
manual 25-transaction action also uses Faker and remains controlled by the debug menu.

## Debug logging

`PUBLIC_DEBUG` is the sole gate for application logging and the developer menu. Vite defaults it to `true` when serving in development mode and `false` otherwise, while preserving explicit shell or mode-specific `.env` values. Set `PUBLIC_DEBUG=false` in `.env.local` to disable debugging locally, then restart the development server. Deployed contexts can opt in with a build-scoped `PUBLIC_DEBUG=true` setting and a rebuild.

The same setting enables the existing developer menu, including its sample transaction controls. The menu trigger retains its existing keyboard-focus behavior and appearance. Sample creation still requires the current workspace's write permissions.

Use `createLogger(scope)` from `src/lib/diagnostics/logger.ts` for application `info`, `warn`, and `error` messages. Select only non-sensitive diagnostic fields; never pass credentials, finance records, provider payloads, or raw errors/messages/stacks. Existing bank diagnostics retain their error classification and timing heartbeats. SDK-internal logs are controlled separately.

All application actor roots and their children report error-state observations through the shared observer, including normal machine failure states and unexpected actor failures. Logs contain the machine/state, triggering event type, actor correlation IDs, sanitized error/cause details and source frames, available status/permission facts, counters, collection sizes and typed failure results. Jazz initialization failures additionally report the public app ID and server origin before a database is available. Identical failure observations are suppressed until their facts change or the actor leaves the failure state. Context payloads and form values are omitted; error text is bounded and redacted rather than logging raw exceptions.

Jazz's embedded inspector requires its development server integration; `PUBLIC_DEBUG` does not enable it in a deployed build. Use the [standalone Jazz Inspector](https://v2.inspector.jazz.tools/) for a hosted lower-environment app, entering its server URL, app ID, and admin secret directly into that tool. Never expose the admin secret through a `PUBLIC_` variable.

With `PUBLIC_DEBUG=true`, the developer menu offers **Open Stately Inspector** and **Open Jazz inspector**. Neither opens automatically. Stately opens a separate browser tab when clicked; allow popups for the app origin if necessary. All application actor roots and their descendants are attached. Sanitized machine descriptions and current states are replayed on connection so opening the inspector after startup still shows existing machines. Inspection includes state values, event types and actor relationships, with context, event payloads, results and raw errors removed before transmission to the external inspector. Error diagnostic context stays in the application's console and is not sent to Stately.

## Native PWA

SvelteKit bundles and registers `src/service-worker/index.ts` in production. `static/manifest.webmanifest` supplies the installation metadata and existing app icon. No PWA plugin or Workbox dependency is used.

The root layout prerenders generic HTML shells for the current routes. The worker precaches those shells, build files, and static assets, so reloads and direct navigation can use the cached app after a successful online installation. Financial data is loaded only in the browser by Jazz; data, authentication, and synchronization requests are not runtime-cached by the worker.

Updates wait until the user chooses “Update and reload” in the drawer above online status, or until the existing app tabs close. “Later” dismisses the same update for that page session. Accepting activates the update and reloads the requesting tab; other tabs offer a reload action without automatically reloading. Unsaved-edit checking is deferred, so accepting can discard unsubmitted form values. Activation failures offer retry after a bounded wait. Validate installation and offline behavior against a production build served over HTTPS or localhost; the development server does not install the production worker.

After implementation review, run `pnpm test:pwa` against a production build with valid public database settings. The dedicated Playwright configuration starts and stops a production preview on `http://127.0.0.1:4173`. It covers an unvisited expense page and reload offline with a persisted account, public cache boundaries, and a worker update waiting without reloading an unsaved form. Its update fixture temporarily changes the generated worker file and restores it afterward; do not run it against a shared deployment or concurrently with a build.

For local verification, keep the development database running and build with `FINANCE_PREVIEW=true PUBLIC_JAZZ_SERVER_URL=<local-database-url> pnpm build`. Use the database URL supplied by the development plugin, which differs from the Vite page URL. Production deployments require their own database settings. Native installation prompts and multi-tab update activation still need browser-specific review.

Workspace authorization checks run with `pnpm test:permissions` against the same development server. They use isolated identities, server-filtered reads, globally settled writes, and owner-side checks for unauthorized changes. Nine role/grant cases pass: unrelated users, admins, members/viewers with all access, selected access without grants, read/write grants, and grants without membership. The category-move regression exposed missing destination workspace authorization. The category update guard now requires owner/admin/member access in both the original and destination workspaces and rejects updates to system categories. After implementation review, all ten permission checks passed, including the previously failing category-move regression. `pnpm check:tests` checks the TypeScript in the browser test files.

Workspace, account-list, and transaction-list checks run with `pnpm test:workspace`. Five workspace tests cover sidebar navigation preserving the workspace and database session, owner/admin renaming, trimmed names and validation retries, reload persistence, member/viewer read-only controls and server-denied writes, and switching workspaces. Two additional account-list tests cover empty results, creation and reload persistence, sorting, archived-account exclusion, live archive updates, and workspace switching. Run just these with `pnpm test:workspace --grep "account list"`. Two transaction-list tests cover empty income/expense views, date ordering, account filters, workspace switching, live inserts, and reload persistence. Run these with `pnpm test:workspace --grep "transaction list"`. Three transaction-form tests cover no-account handling, expense/check-income saves, workspace-specific options, archived and wrong-kind filtering, check details, and adding another transaction. Run these with `pnpm test:workspace --grep "transaction form"`. Account-form validation/workspace-reset tests run with `pnpm test:workspace --grep "account form"`. Open `/settings/workspace` through the sidebar’s Workspace link.

## Project documents

Account restoration checks run with `pnpm test:auth`. The dedicated suite uses two isolated browser profiles and starts its own disposable development server at `http://127.0.0.1:5180`. It checks recovered accounts, workspace reuse, repeated restoration, reloads, and starter category counts. Trace, screenshot, and video capture are disabled for this recovery-phrase workflow. Workspace initialization reads existing records before opening its write transaction and waits for local persistence. This prevents cold reloads from recreating protected records and leaving rejected writes that block account restoration. Eight consecutive restoration runs passed after the fix; the final three also checked starter category counts. The account creation/expense entry regression passed as well.

- [Constitution](.specify/memory/constitution.md): architecture and implementation rules.
- [MVP specification](specs/001-finance-mvp/spec.md): product requirements and acceptance criteria.
- [Implementation plan](specs/001-finance-mvp/plan.md): technical design and phases.
- [Task checklist](specs/001-finance-mvp/tasks.md): implementation backlog.
- [Original planning notes](finance_jazz_svelte_1ec5536a.plan.md): source material for the formalized artifacts.
- [Manual bank-sync specification](specs/002-manual-bank-sync/spec.md): manual SimpleFIN imports and passkey-protected credentials across the connecting user's devices.
- [Bank-sync requirements checklist](specs/002-manual-bank-sync/checklists/requirements.md): specification quality review.

The bank-sync specification reflects the approved passkey direction. Its [implementation plan](specs/002-manual-bank-sync/plan.md), research, data model, behavior contract, and quickstart still describe the earlier device-local credential design and must be aligned before bank-sync implementation. The plan contains an explicit warning; these documents are not implementation-ready.

## Spec Kit

This project uses GitHub [Spec Kit](https://github.com/github/spec-kit) with the Codex integration. Spec Kit skills are in `.agents/skills/`, and shared workflows and templates are in `.specify/`. Start with the spec artifacts above; use `$speckit-clarify` before implementation if unresolved product decisions need discussion.

## Planned GitHub namespace

`https://github.com/delightful-labs/`

## Planned bank credential protection

The approved bank-sync design encrypts the SimpleFIN Access URL locally using a PRF-capable passkey and replicates only ciphertext and non-secret unlock metadata through Jazz. The password manager, such as 1Password, separately syncs the passkey. The same signed-in user can unlock the connection on compatible devices with that original passkey; organization membership alone does not grant decryption access.

Before consuming a SimpleFIN setup token, the app will verify encryption and subsequent decryption with a harmless sample. Each manual sync will require passkey verification, use the credential transiently, then lock again. Setup tokens, plaintext credentials, and usable decryption keys will not be persisted or replicated. There will be no automatic transaction fetching or retries. Lost-passkey recovery initially means reconnecting SimpleFIN; invalidating a previously copied Access URL requires provider-side revocation.

This is planned behavior, not an implemented bank integration. Sharing credentials with other organization members and additional recovery mechanisms are out of scope. An initial passkey prototype demonstrated successful sample recovery in the reported browser trial and has been removed. Physical-device passkey synchronization and production Jazz credential replication remain unverified.

## Source organization and browser tests

Feature browser regressions live in `tests/features/`; shared workspace and transaction
fixtures live in `tests/helpers/`. Shared workflow contracts live in `src/lib/contracts/`;
application shell and navigation components live in `src/lib/components/navigation/`. Keep schema and permission deployment
entry points in `src/lib/schema.ts` and `src/lib/permissions.ts`.

Components and machines use feature folders such as `accounts/`, `identity/`, `workspaces/`,
`transactions/`, and `transfers/`. Machines retain their colocated tests and fixtures.
Shared logging and inspection live in `src/lib/diagnostics/`; session/context/lifecycle
helpers live in `src/lib/runtime/`. Form, filter, and authorization helpers have their own
library directories. Keep new files with the feature or responsibility they implement.

`pnpm test:e2e` runs all development-server scenarios through four disjoint projects:
`application`, `authentication`, `permissions`, and `workspace`. CI uses these same projects
and shards the application project across two jobs. Local runs default to one worker;
CI uses up to two workers with isolated browser contexts. Authentication retains its serial
60-second budget; production and flag-specific environments stay serial. Production PWA,
stalled-remote startup, debug, and fake-data flag scenarios use their own runtime configurations under `tests/config/`.

Use `pnpm test:attachments`, `pnpm test:description`, or a config in `tests/config/` for focused
runs. Cross-cutting selections use scenario tags, so moving or renaming a scenario does not
silently remove it from a feature selection. `pnpm check:e2e` verifies that projects
are disjoint and that every tagged feature selection exactly matches its coverage in the
canonical run; CI runs this discovery check without launching a browser or server. For example:

```sh
pnpm test:e2e --grep @attachments
pnpm test:e2e --grep @account-archive
pnpm test:e2e --project workspace
pnpm exec playwright test --config tests/config/playwright.transaction-workspace.config.ts
```

The default agent port is 5180. Set `FINANCE_E2E_PORT` to choose another port. Start a known
agent server with `pnpm dev:agent --host 127.0.0.1 --port 5182 --strictPort`, then set
`FINANCE_E2E_PORT=5182 FINANCE_E2E_REUSE_SERVER=true` to reuse it across focused runs.
Reuse is opt-in and disabled in CI; do not reuse unidentified servers. Run tooling in a
separate checkout with its own dependencies while the user's development server is running.

Failure screenshots and a machine-readable duration report are written to `test-results/`.
CI also retains failure traces. For local traces, pass `--trace retain-on-failure`; local
development runs leave tracing off by default. Override concurrency with `--workers`. Use `pnpm test:pwa`, `pnpm test:startup`, and the CI feature-flag
matrix for the separate production and flag-dependent environments.
