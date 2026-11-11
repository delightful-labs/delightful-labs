# Finance project guidance

Read the [workspace entry](../../AGENTS.md) and shared guides first. The user's
stricter common engineering, copy, type and test-review requirements apply.
Follow the [constitution](.specify/memory/constitution.md) and local active
feature for financial, organization/access, provider-secret and persistence rules.

- Before Finance workflows or SDK work, read [workflow extensions](.specify/memory/xstate.md)
  and [Jazz/schema memory](.specify/memory/jazz.md). Generic foundation lifecycles
  belong in Local First; native finance schemas, policy, routing, provider work
  and financial resource drains remain here.
- Use the local [Paraglide conventions](.specify/memory/localization.md) for noun/
  action/input naming, component catalogs and descriptor-based feedback. The
  shared explicit string/catalog/generation approval rule takes precedence over
  any instruction to consolidate or regenerate copy automatically.
- Keep components small and composed from UI primitives. Schema and validation
  filenames correspond (for example transactions.ts in both directories); keep
  canonical validation and derived form adapters together. Page/integration
  bridges bind dependencies and observations; domain work follows shared worker
  ownership rather than being hidden in component scripts/controllers.
- Use the existing Prettier configuration. Read [testing environment details](.specify/memory/testing.md)
  before browser work. The user's 5173/5174 environment and data are protected;
  `pnpm dev:agent` uses disposable in-memory Jazz storage. Reuse only known agent
  servers with distinct ports and isolated generated files/node_modules.
- The [v6 migration design](specs/013-local-first-startup/xstate-v6-migration.md)
  and active feature own current runtime qualification. Historical alpha.59/v5
  research is not current SDK/API syntax. Read exact installed docs before changes.
