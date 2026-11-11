# Delightful Labs workspace

A pnpm workspace, starting with the website at [`apps/website`](apps/website/README.md).
The UI library is at [`packages/ui`](packages/ui/README.md). The Local First source is at
[`packages/local-first`](packages/local-first/README.md). Finance and Clipper imports are tracked in the
[migration implementation record](specs/002-monorepo-agent-guidance/implementation.md).

Use Node 24 (`nvm use`) and pnpm 10.28.0. From this directory:

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

The website retains its vendored UI package during this move. There are no
library workspace links yet, and there is no Nx or additional task orchestrator.
See the [archive findings](specs/002-monorepo-agent-guidance/archive-findings.md)
before replacing an internal archive.

For Vercel, the website's configuration and `.vercel/output` are now app-local.
A hosted build needs Root Directory `apps/website`, with access to files outside
that directory for the root workspace/lockfile. This branch changes no hosted
project setting and deploys nothing; verify a preview before any source handoff.
See the [website slice record](specs/002-monorepo-agent-guidance/website-move.md).

Read [AGENTS.md](AGENTS.md) for guidance scope and project-local Spec Kit usage.

UI commands from the root: `pnpm ui:check`, `pnpm ui:test`, `pnpm ui:package`,
and `pnpm ui:build`. Imported projects use the root lockfile. The UI source import
retains original history; see [its slice record](specs/002-monorepo-agent-guidance/ui-import.md).

Local First package commands: `pnpm dlf:check`, `pnpm dlf:package`. Run the approved verification suite with `pnpm dlf:verify`. Its
implementation review gate remains effective for subsequent changes; see
[the import record](specs/002-monorepo-agent-guidance/local-first-import.md).
The [alpha.60 source adapters](specs/002-monorepo-agent-guidance/alpha60-adapters.md)
are qualified locally. Consumer archives remain in place until their workspace
links and required presentation/runtime patches are qualified.
