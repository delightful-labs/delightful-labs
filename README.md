# Delightful Labs workspace

A pnpm workspace containing the website at [`apps/website`](apps/website/README.md).
The UI library is at [`packages/ui`](packages/ui/README.md). The Local First source is at
[`packages/local-first`](packages/local-first/README.md). Finance is at [`apps/finance`](apps/finance/README.md); Clipper web and extension are at `apps/clipper/apps/web` and
`apps/clipper/apps/extension`. Progress is tracked in the
[migration implementation record](specs/002-monorepo-agent-guidance/implementation.md).

Ongoing development for all apps and libraries belongs in
`delightful-labs/delightful-labs`, using feature branches and PRs targeting `master`.
The core migration and application hosting handoff are complete. The
[closeout record](specs/002-monorepo-agent-guidance/closeout.md) is the current
status and outstanding-work inventory; older slice records retain historical
evidence. Source repositories remain available and unarchived for history and
their explicitly retained work. Finance's application-worker migration is deferred,
and public extension release is out of scope for now.

Use Node 24.22.2 (`nvm use`) and pnpm 10.28.0. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test
pnpm build
pnpm test:build
pnpm test:browser
```

These commands delegate to the website. For a distinct port, run
`pnpm dev --port 5183 --strictPort`; Vite prints localhost and LAN URLs.
You can also run app commands inside `apps/website`, or use
`pnpm --filter delightful-labs <command>`. Root `pnpm exec` does not resolve app
binaries; use `pnpm --filter delightful-labs exec <binary>` instead.

Environment files belong in `apps/website`; copy that app's `.env.example` there
when needed. Existing local files in other checkouts are untouched.
Generated output, browser evidence and caches belong to the app directory.

All consumers now use workspace UI with their own Svelte peer. The website and
Local First Storybook import `delightful-ui/theme-classic.css` to retain their
existing typography; the current default theme remains available to other apps.
There is no Nx or additional task orchestrator.
See the [archive findings](specs/002-monorepo-agent-guidance/archive-findings.md)
before replacing an internal archive.

For Vercel, the website's configuration and `.vercel/output` are now app-local.
A hosted website build uses Root Directory `apps/website`, with access to files
outside that directory for the root workspace/lockfile. Finance uses
`apps/finance`; Clipper uses `apps/clipper/apps/web`. All three applications are
connected to this repository. Exact application cutover and rollback evidence is
in the [handoff record](specs/002-monorepo-agent-guidance/app-preview-handoff.json);
the closeout record links the website's hosting and domain verification.

Read [AGENTS.md](AGENTS.md) for guidance scope and project-local Spec Kit usage.

UI commands from the root: `pnpm ui:check`, `pnpm ui:test`, `pnpm ui:package`,
and `pnpm ui:build`. Imported projects use the root lockfile. The UI source import
retains original history; see [its slice record](specs/002-monorepo-agent-guidance/ui-import.md).

Local First package commands: `pnpm dlf:check`, `pnpm dlf:package`. Run the approved verification suite with `pnpm dlf:verify`. Its
implementation review gate remains effective for subsequent changes; see
[the import record](specs/002-monorepo-agent-guidance/local-first-import.md).
The [alpha.60 source adapters](specs/002-monorepo-agent-guidance/alpha60-adapters.md)
are qualified locally. Finance and Clipper consume its qualified workspace source; historical archives
remain only where retained for provenance/fixtures.

Finance commands: `pnpm finance:check`, `pnpm finance:test`,
`pnpm finance:test:worker-state`, `pnpm finance:test:worker-host` and
`pnpm finance:build`. Use `pnpm --filter delightful-finances <command>` for other
app scripts. Frozen installation prepares the injected UI package; after editing
UI, run `pnpm ui:package` to refresh its peer-specific copies.
See [the Finance import record](specs/002-monorepo-agent-guidance/finance-import.md)
for retained archives and isolated test configuration. Hosting cutover is complete;
the [closeout inventory](specs/002-monorepo-agent-guidance/closeout.md) tracks deferred Finance work.

Clipper commands: `pnpm clipper:check`, `pnpm clipper:test`,
`pnpm clipper:build`, `pnpm clipper:build:extension` and `pnpm clipper:verify`.
Its web and extension consume workspace UI and Local First packages, prepared
on install and refreshed by `pnpm build:libraries`. Browser commands retain
their disposable test backends; see the scoped Clipper guidance before running.

After installation, `pnpm monorepo:check-links` verifies all eight UI/foundation links, including
website and Local First development. It checks each consumer's required Svelte,
Jazz and XState instances. CI
runs it before compilation. See [historical qualification](specs/002-monorepo-agent-guidance/qualification.md)
and the current closeout record for subsequent hosted acceptance.

[UI compatibility qualification](specs/002-monorepo-agent-guidance/ui-workspace-links.md)
records the retired snapshots, classic-theme provenance, packed-export checks
and unchanged website screenshots.

Shared engineering guidance starts at [AGENTS.md](AGENTS.md). The stricter common
rules apply to every app and package; local constitutions and product contracts
retain their own scope. Run `pnpm monorepo:check-guidance` for maintained guidance
links, shared tooling ownership and read-only discovery in all six contexts.
Run `pnpm monorepo:test-tooling` for the CI selector and guidance regressions.

Every PR gets a Conventional Commits title check, including drafts and app-only
changes. Existing CI jobs select affected projects and transitive consumers;
root/unknown paths, missing history and manual runs select all. The
[shared-guidance/CI record](specs/002-monorepo-agent-guidance/shared-guidance-ci.md)
records the exact policy resolution, dependency closure and local verification.
