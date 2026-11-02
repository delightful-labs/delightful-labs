# Delightful Local First

Shared local-first app foundation using Jazz for v1, informed by Delightful Finance and Delightful UI. Focused SDK boundaries leave room for future backend replacement.

This repository contains the Jazz-only MVP specification, developer tooling, recovery presentation,
identity restoration, session acquisition/readiness, workspace-selection workflows, and explicit private-creation transaction ownership. Finance adopts
these incrementally through its host session and schemas, retaining its routes, journals and domain
records. Workspace selection coordinates leases/resource drain; explicit creation settles locally
without waiting for server acceptance. The full MVP and independent demonstration consumer remain future
work. See the [current contract map](specs/001-local-first-foundation/contracts/foundation.md) for
implemented subpath exports and the [workspace plan](specs/001-local-first-foundation/workspaces/plan.md)
for selection and private-creation ownership and qualification.

The workspace selector composes DUI with a controlled host-applied value and caller-localized text.
Its local directory projection requires no client or actor. See the [composition plan](specs/001-local-first-foundation/workspaces/compositions/plan.md)
for the package boundary and Finance adoption evidence. Creation-dialog composition remains separate.

- [Foundation specification](specs/001-local-first-foundation/spec.md)
- [Specification quality checklist](specs/001-local-first-foundation/checklists/requirements.md)

The [implementation plan](specs/001-local-first-foundation/plan.md) records delivered slices and remaining work. A second backend, portable schemas, and independent plugins are deferred.

## Spec Kit

The repository is bootstrapped from the existing local Spec Kit 1.1.3 scaffold because the `specify` CLI is not installed. Templates, shell scripts, workflows, and Codex skills are included. No extension hooks are installed. `.specify/feature.json` identifies the active feature independently of the Git branch.

The [project constitution](.specify/memory/constitution.md) is adopted, with governance adapted from Finance and explicit backend integration boundaries.

Use the local Spec Kit skills for later focused planning. The active Jazz-first specification and current contract replace the old multi-backend design.

## Tooling

Use Node.js 22.17+ on the 22.x line, or Node.js 24+ and pnpm 10.22.0. Run `pnpm install --frozen-lockfile` to install the pinned development tools.

- `pnpm format` formats repository-owned files with Oxfmt.
- `pnpm format:check` checks formatting without writing files.
- `pnpm lint` runs Oxlint with correctness errors, explicit `any` prohibited, and type casts prohibited.

Inherited Spec Kit scripts, templates, and skills are excluded from formatting and linting. Avoid formatting unrelated files when making changes; use `pnpm exec oxfmt <paths>` for a focused change.

`pnpm check` runs strict Svelte and TypeScript checks. `pnpm package` builds the private package
and validates it with publint; run `pnpm check:consumer` afterwards to check built public exports.
`pnpm test:unit --run` runs the approved machine unit coverage.
`pnpm verify` runs static checks, unit tests, packaging, consumer checks, and Storybook in CI order.
See [developer tooling](docs/development.md) for import boundaries, editor setup, limitations,
and dependency update/PR conventions. The root package entry remains empty; recovery uses separate exports.

The recovery workflow uses XState; its presentation uses DUI with library-owned Paraglide messages.
The Jazz adapter and owned recovery composition have unit, SSR, package-consumer, and synthetic
browser coverage. Finance validates packed snapshots incrementally against its existing host session and schemas.
SvelteKit hosting remains later work; the implementation-review gate still applies to new behavior
and its tests. Synthetic Chromium coverage is available through `pnpm test:storybook` after building Storybook.

## Storybook and Netlify

- `pnpm storybook` starts the local workbench at `http://127.0.0.1:6006` with an exact port.
- `pnpm build-storybook` builds static documentation into `storybook-static/`.

The initial Introduction page documents ownership and project status. Add reviewed component stories
under `stories/` as library components are implemented. The workbench has a dedicated Vite config,
so a future SvelteKit app does not implicitly change its build. Storybook telemetry is disabled.

`netlify.toml` builds and hosts the static Storybook with Node 24 and the pinned pnpm version.
It does not deploy Jazz schemas or require Finance credentials. Connecting this repository to a
Netlify site is a separate hosting action; no site is created or published by this tooling change.

## GitHub CI

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatch. It installs the frozen
lockfile, checks formatting, lint and types, runs unit coverage, validates the package and consumer fixture, then builds Storybook and runs synthetic Chromium coverage. Permissions are read-only and superseded
runs are cancelled. No deployment secrets are required. Branch protection and required checks must be
configured separately after the workflow is available remotely.

New unit/browser coverage is added only after implementation review. Current unit coverage verifies
the recovery workflow, localization, Jazz adapter, and SSR boundary; browser coverage checks the
synthetic recovery UI and owned integration. A separate workflow checks Conventional
Commits PR titles.

See [recovery presentation and localization](docs/recovery-view.md) for public imports, message
overrides, catalog editing, and the current review/verification limits.

See [owned recovery integration](docs/recovery-integration.md) for host scope observations,
actor lifetime, Jazz module sharing, and adapter/integration coverage.

Identity restoration is implemented and merged, with Finance retaining workspace draining and navigation. The next design review is [session startup and resume](specs/001-local-first-foundation/startup/plan.md), separating shared acquisition from application attachment.
