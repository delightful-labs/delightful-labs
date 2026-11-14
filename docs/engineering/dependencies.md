# Dependencies, boundaries and tooling

Use Node 24.22.2 and pnpm 10.28.0 with the root workspace/lockfile. Obtain explicit
user approval before adding a new third-party dependency: state its purpose and
alternatives. A package mentioned in a plan is not approval. A user request to
install a named package supplies authorization. Frozen installation of already
approved dependencies and ordinary documented checks is distinct from adding a
new dependency. Do not force unrelated upgrades to make workspace wiring pass.

Use strict types in new/changed application and library code. Do not introduce
`any`, TypeScript assertions (including `as`/`as const`), switch or case clauses.
Use unknown with narrowing, discriminated unions, generics, satisfies and typed
adapters. Use functions, closures and plain records; do not introduce application-
owned classes/inheritance. Keep required variant-specific fields explicit. Existing inherited
Spec Kit tooling remains tooling; this rule does not authorize a mass rewrite.
Pin/review beta APIs and use installed documentation. Do not patch XState or its
public declarations. Existing qualified SDK/auth patches retain their ownership.
Prepare a solution using supported APIs without new dependency patches first.
Discuss a patch only after identifying a concrete limitation of that solution;
simpler application coordination alone does not make a patch the default.

Consume UI and Local First through supported public workspace exports. UI owns
generic presentation; Local First owns reusable identity/workspace/operation
foundations; apps own domain schemas, policies and operations. Keep app domains
out of shared foundations. Existing Clipper extension-to-web source references
are a recorded migration compatibility debt, not permission for new private
cross-project imports. New/reworked boundaries need public contracts before
adoption; preserve existing behavior until that extraction is separately reviewed.

Peer-specific injected copies preserve consumer Svelte/SDK identities. Run
`pnpm build:libraries` after shared package edits and `pnpm monorepo:check-links`
after install. Keep the canonical lock's coherent SDK contexts; do not suppress
branded-type errors with casts. Verify packed exports as well as workspace links.
Remove superseded active artifacts with a qualified replacement; retain unrelated
historical/provenance fixtures and imported Git history.

## Formatting and project commands

Use each project's existing formatter/configuration, format only touched files,
and avoid unrelated rewrites. These are scoped tool choices, not competing
strictness rules:

| Project | Tooling and entry |
| --- | --- |
| Website | Existing two-space/double-quote/semicolon conventions; app scripts |
| Finance | Its Prettier config; `finance:*` or app scripts |
| UI | Its Prettier/Svelte config; `ui:*` |
| Local First | Oxfmt/Oxlint with Svelte formatting; `dlf:*` |
| Clipper web/extension | Oxfmt/Oxlint with Svelte formatting; `clipper:*` |

Keep Svelte script/markup/CSS readable with multiline declarations and separation
between CSS rules. Never turn off Svelte formatting to make a migration pass.
Root default dev/check/test/build commands still invoke the website. Scoped
commands and release identities remain independent; no additional task
orchestrator is introduced.
