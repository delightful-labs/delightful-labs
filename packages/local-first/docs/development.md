# Developer tooling

The tooling validates build/package infrastructure and the initial recovery workflow. The root
entry point remains empty; recovery contracts and workflow have separate public exports. XState
is an optional peer used by the workflow entry. The pure recovery view uses a host-supplied optional DUI peer; a separate optional Jazz peer is used only by the new adapter entry. No consumer migration is introduced.
The package remains private and no release/publish workflow is configured.

## Static checks

Use the Node 24 line in `.node-version` and pnpm 10.22.0 from `package.json`.
Install with `pnpm install --frozen-lockfile`, then run `pnpm verify` for the CI checks locally.

- `pnpm format:check`: repository Oxfmt formatting.
- `pnpm lint`: Oxlint correctness, no explicit any/casts, and import-boundary restrictions.
- `pnpm check`: strict Svelte diagnostics and TypeScript/JavaScript checks, including configs.
- `pnpm test:unit --run`: approved workflow, localization, adapter, and SSR scenarios.
- `pnpm package`: generate `dist` JavaScript/declarations with svelte-package and run strict publint.
- `pnpm check:consumer`: after packaging, resolve declarations with NodeNext, import non-UI ESM,
  exercise an isolated host-issued Jazz handle, and bundle public components with Svelte-aware Vite.
  No source path mapping is used.
- `pnpm build-storybook`: static documentation build.

The consumer fixture checks root and recovery subpath imports using package self-reference and
generated `dist` exports. UI source is consumed by a Svelte-aware build rather than plain Node. It catches missing
entry points and declaration resolution problems; it is not yet an isolated installed-tarball or
component rendering check. Publint separately inspects package metadata and publishable files.
Extend the fixture to real public APIs in the focused implementation that introduces those APIs.

TypeScript is strict with unchecked indexed access and exact optional properties. Dependency type
internals are skipped in the main check; owned files are checked. The package consumer enables
dependency declaration checking so broken emitted type references are not hidden. Its
`exactOptionalPropertyTypes` is explicitly disabled: XState 5.33.2 has an upstream `setup.d.ts`
`StateSchema.id` constraint error when that option and dependency declaration checking are both
enabled. Library source retains exact optional checking with dependency internals skipped. This
fixture therefore qualifies the documented consumer configuration, not every stricter combination. Svelte diagnostics fail on warnings. Oxlint does not
provide full Svelte template linting; compiler diagnostics and type checks complement its script
checks. Machine ownership and cleanup still need review; static checks cannot establish runtime
correctness. No-switch enforcement remains a review rule, not a claim made by this lint configuration.

## Import boundaries

| Location                     | Responsibility                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/lib/backend/jazz/`      | Only library source allowed to import Jazz directly; SDK schema/policy mappings and leaf operations    |
| `src/lib/machines/`          | Reusable typed workflows consuming backend boundaries                                                  |
| `src/lib/integrations/`      | Dependency binding, subscriptions, actor attachment, and composition                                   |
| `src/lib/components/`        | Pure presentation, data/view models and callbacks; no XState, machine, backend, or integration imports |
| `fixtures/package-consumer/` | Built public-package resolution checks, not library source                                             |

Oxlint checks static imports/re-exports and literal dynamic imports, including type imports. The
Finance package/path names are prohibited throughout the repo. Library Jazz imports are restricted to the
backend directory; the isolated package-consumer Jazz host fixture has a narrow exception, and pure components additionally reject actor packages and orchestration paths.
Types needed by views should be exposed through focused actor-free contracts rather than machine
files. New aliases and barrel re-exports must preserve these boundaries during review: this is
specifier-based enforcement, not a transitive dependency graph analysis. Computed dynamic imports
are outside the check and must not be used to bypass it.

The directory names establish tooling conventions, not a settled runtime design or permission to
implement it. The [recovery plan](../specs/001-local-first-foundation/plan.md) defines the first slice;
the owned recovery integration and Jazz adapter implement its next boundary. Finance adoption remains separate.

## Unit coverage and review

`pnpm test:unit` starts Vitest in watch mode; use `pnpm test:unit --run` for a single run.
The dedicated Node configuration discovers machine, localization, adapter, and SSR tests. It uses
Svelte and SVG transforms to render real DUI components, without loading SvelteKit or Storybook.
The consumer and Storybook builds use the same SVG transform required by DUI imports. Tests are
type-checked with the source and run in CI after static checks. Adapter tests create disposable
SDK credentials in an in-memory store; no Jazz server, user data, or real account is used.

`pnpm test:storybook` runs the synthetic Chromium recovery scenarios after `pnpm build-storybook`.
See [recovery presentation](recovery-view.md#running-focused-coverage) for browser installation,
known-server reuse, and alternate ports. CI builds the static stories and runs those scenarios;
`pnpm verify` covers the non-browser checks and build.

The recovery suite covers acknowledgement/dismissal, observed and unobserved scope changes,
A → B → A correlation, delayed resolution/rejection after cancellation, guarded retries, and
terminal cleanup. Tests use real actors and the public view selector; synthetic values are safe
in assertions. Adapter and owned-composition coverage is described in [recovery integration](recovery-integration.md#coverage-and-next-adoption).
Packed Finance adoption remains a later review cycle.
Implementation must be reviewed and approved before its tests are added or run; acceptance of the
contracts/workflow cycle authorized this initial coverage, not tests for unbuilt later slices.

## Editor setup

`.editorconfig` supplies tabs, UTF-8, LF endings, and final newlines; Markdown/YAML use spaces.
`.vscode/extensions.json` recommends Svelte, Oxc, and EditorConfig extensions without forcing
editor-wide settings. The repository formatter configuration remains authoritative.

## Pull requests and dependencies

Use Conventional Commits titles: `type(scope): description`, with optional scope and `!` for a
breaking change. The PR-title workflow checks the event payload without interpolating PR text
into shell commands. The PR template captures behavior, ownership, validation, and test approval.
It does not replace the user review required before implementation tests are added or run.

Dependabot checks npm/pnpm dependencies and GitHub Actions weekly. Storybook updates are grouped;
minor/patch Svelte toolchain and development-tool updates are grouped separately. Other major
updates remain individual except the deliberately coordinated Storybook group. No auto-merge is
configured. The rules take effect after merge to the default branch; existing alerts/security
update settings and required branch checks are GitHub repository settings, not changed here.

## References

- [Svelte packaging](https://svelte.dev/docs/kit/packaging)
- [Svelte diagnostics](https://github.com/sveltejs/language-tools/blob/master/packages/svelte-check/README.md)
- [Oxlint import restrictions](https://oxc.rs/docs/guide/usage/linter/rules/eslint/no-restricted-imports)
- [Publint](https://publint.dev/docs/)
- [Dependabot configuration](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference)
