# Workspace guidance

This is the Delightful Labs pnpm workspace. The website and UI library are imported. Work on the monorepo migration from
[the active migration spec](specs/002-monorepo-agent-guidance/spec.md) and
[implementation record](specs/002-monorepo-agent-guidance/implementation.md).

## Scope and discovery

- For website source, configuration, tests, publishing or content, read
  [apps/website/AGENTS.md](apps/website/AGENTS.md) and its project-local active feature.
  Website product and publishing restrictions apply to that app.
- For UI work, read [packages/ui/AGENTS.md](packages/ui/AGENTS.md) and its linked
  machine-design and testing guidance. UI policies remain scoped to the library.
- Finance, Clipper and Local First have not been imported. Their source
  guidance remains effective in their repositories. Do not treat their policies
  as reconciled workspace rules. See the migration inventories and findings.
- For state machines/resource ownership, localization, accessibility, testing,
  dependencies or releases, follow the applicable project's entry file and linked
  specification. The migration has not yet activated shared topic policies.
- Respect current user instructions and tool-level precedence. Keep local
  exceptions explicit; moving files does not waive an applicable approval gate.
  Unresolved source-policy conflicts block only the affected migration slice.

## Working in the workspace

- Use pnpm 10.28.0 and Node 24 for the imported website and UI library.
  Qualification for the remaining projects is pending. Root app commands delegate to `apps/website`.
- Start development servers on `0.0.0.0`, announce localhost and LAN URLs when
  available, and use distinct available ports. Preserve unidentified servers.
- Root `.specify/feature.json` selects migration work; the website has its own
  selector. Never overwrite a sibling's feature state. Shared Spec Kit skills,
  templates and helpers remain at root; website `.specify/` links to the reusable
  files. Run helpers from the target project directory, or set `SPECIFY_INIT_DIR`
  to its absolute path. Do not run a mutating helper against the wrong selector.
- This repository has no ratified constitution. The constitution template is not
  active policy. Website publishing and production-cutover gates remain local.
