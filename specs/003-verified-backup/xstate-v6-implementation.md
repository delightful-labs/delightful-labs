# XState v6 implementation review

Status: implementation review candidate, 2026-11-09. Behavioral qualification pending.
PR: https://github.com/delightful-labs/delightful-local-first/pull/37

## Versions and baseline

Source baseline: main `be40b8fd1e7e417ac447b45cd81437a407634675`.
Runtime and optional peer: `xstate@6.0.0-beta.1`. Migration tooling:
`@xstate/codemod@0.1.0-beta.1`, followed by manual generic-contract and runtime
semantics review. The v5 baseline remains available in Git; no behavioral baseline
was executed in this implementation phase. Jazz remains `2.0.0-alpha.59`.

## Changes for review

- Production forms, identity/session, workspace and backup machines use schemas,
  function transitions, immutable context patches and queued effects. Async and
  native callback leaves use the v6 logic factories. Generic output/input
  contracts are explicit where the codemod lost their inference.
- Sources use direct logic and `createInvoke` for generic inference. The form
  writer deliberately retains a registered v6 source for its native/consumer
  logic union. Its input cannot be inferred through the direct-source union.
- Final-state cleanup and outcome selection run on incoming transitions through
  typed finalizers. Final node names remain stable and nodes are inert.
  Parallel region cancellation, sibling reentry and effect order require replay
  qualification; static typing does not prove equivalent scheduling.
- Startup uses scoped child references. Writer failure uses the reported error
  rather than reading a completed child. Observer failure uses the stable
  lifecycle event category and actor identity.
- Transaction custody keeps receipt bookkeeping in a private closure behind a
  frozen interface. Retention, late acquisition and owner-error observation
  remain in place pending v6 native qualification.

## Declaration patch and consumers

`patches/xstate@6.0.0-beta.1.patch` changes only two upstream declarations:
`RequiredContextKeys` recognizes assignable current/target context before
requiring patch keys; `InferOutput` preserves type-only generic schema outputs
without expanding them through `Compute`. Runtime JavaScript is unchanged.
These are local beta compatibility fixes, not claimed upstream fixes.

The root pnpm configuration applies the patch with a locked hash. The archive
includes the patch, but consumers must explicitly register it in their own root
`patchedDependencies`; pnpm does not inherit dependency patch settings. Reassess
these fixes on each beta update. No v5/v6 peer compatibility is claimed.

The vendored DUI archive is unchanged. Its independent UI actors and consumer
archives still require coordinated v6 adoption; do not pass v5 actor refs or
logic into these v6 graphs. Finance's UI/worker split and Clipper Jazz patch
qualification remain consumer work under the migration specification.

## Validation and next gate

`check:library` checks production TypeScript and Svelte sources, excluding test
files. Packaging uses the same production configuration. This is an intermediate
validation boundary, not a replacement for the existing full `check` or `verify`.

Completed checks: `pnpm check:library` (zero Svelte errors/warnings and passing
production TypeScript), changed-source Oxlint with denied warnings, Oxfmt,
`git diff --check`, and `pnpm package` including strict Publint.

Implementation tests and legacy fixtures have not been migrated or run. The
repository requires user review and approval before adding or running them.
Implementation commits use `[skip ci]` because the PR workflow runs those tests
automatically; required CI remains pending until the review gate is cleared.

After approval:

1. Migrate v5 test harnesses and fixtures, capture v5 traces from the baseline and
   compare v6 branch, cancellation, generation and terminal-output behavior.
2. Qualify parallel-region reentry/joins, secret clearing, late acquisition,
   issued writes, native disposal, custody after owner errors and uncertain
   settlement. Retain recovery ownership until each boundary is proven.
3. Run full checks, packaged consumer declarations/imports, native backup/Jazz
   fixtures and Storybook/browser flows. Verify optional independent subpaths
   without XState and an actual patched consumer installation.
4. Build identifiable archives and qualify Clipper/Finance adoption separately,
   including worker storage identity, offline restart, multi-tab and drain.

No runtime-equivalence, browser, native, worker or downstream readiness claim is
made by the production type check or package build.
