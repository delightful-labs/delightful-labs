# Delightful Labs workspace

Start here for every task, then read the applicable local entry and active
feature. The [migration record](specs/002-monorepo-agent-guidance/implementation.md)
tracks source imports and qualification; it is not permission for production cutover.

## Read by task

| Task | Authoritative shared guide |
| --- | --- |
| Scope, review, approvals, feature selection or conflicts | [Scope and approvals](docs/engineering/scope.md) |
| Workflows, async effects, persistence, actor/resource lifetime | [State machines](docs/engineering/state-machines.md) |
| Product wording, labels, messages, catalogs or locale callers | [Localization](docs/engineering/localization.md) |
| Components, styling, native behavior or accessible interaction | [Accessibility and CSS](docs/engineering/accessibility.md) |
| Tests, fixtures, browser environments or verification claims | [Testing](docs/engineering/testing.md) |
| Types, dependencies, package boundaries, install or formatting | [Dependencies and tooling](docs/engineering/dependencies.md) |
| PRs, CI selection, package releases or hosted changes | [Review and releases](docs/engineering/releases.md) |

The user explicitly directed the stricter engineering rules to apply to all
projects. These guides own shared practice; weaker historical wording is not an
exception. Existing task-specific user approvals retain their scope and precedence.
Different translation architectures/formatters remain explicit boundaries, not
silent relaxations. No constitution is globally adopted. Amend a common practice
in its guide and document approved local exceptions in the same review.

## Shared implementation rules

Never hand-write SVGs, SVG paths, or inline SVG markup. Use DUI's `Icon`
component with premade icon components from the existing icon library
(`tdesign-icons-svg`). This rule applies across all workspace apps and packages.

When an app needs a capability missing from DUI, propose a supported DUI API
change instead of adding an app-level workaround. The monorepo allows the shared
primitive and its consumers to be updated together. Keep reusable behavior in DUI
and domain behavior in the app.

## Project context

- Website: [apps/website/AGENTS.md](apps/website/AGENTS.md), owner-controlled
  typography/content and its local feature selector.
- Finance: [apps/finance/AGENTS.md](apps/finance/AGENTS.md), its constitution,
  money/tenancy/provider policies and local feature selector.
- Clipper web and extension: [apps/clipper/AGENTS.md](apps/clipper/AGENTS.md),
  its product/account/worker/extension contracts and coordinator feature selector.
  Both sibling app directories inherit that entry.
- UI: [packages/ui/AGENTS.md](packages/ui/AGENTS.md), generic presentation and
  version-qualified component/machine docs; it has no separate feature selector.
- Local First: [packages/local-first/AGENTS.md](packages/local-first/AGENTS.md),
  its scoped constitution, foundation contracts and local feature selector.

## Working in the workspace

Use Node 24.22.2 and pnpm 10.28.0. Root default dev/check/test/build commands invoke
the website; scoped commands are in [README.md](README.md). Use supported workspace
exports and run `pnpm monorepo:check-links` after installation. CI selection is
conservative for root, unknown or shared dependency changes.

Start development servers on 0.0.0.0, announce localhost and LAN URLs when
available, use distinct available ports and preserve unidentified listeners/user
data. User-facing servers use a named tmux window; disposable test fixtures keep
their explicit origins. Isolate generated files and node_modules from user servers.

Root `.specify/feature.json` selects migration work. Shared Spec Kit skills,
templates and helpers have one root owner. Run them from the target project or
set SPECIFY_INIT_DIR to its absolute path; never overwrite a sibling's selector.
The root constitution template is not active policy. Source history, inventories
and per-rule dispositions remain in the migration records.
