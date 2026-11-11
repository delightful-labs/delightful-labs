# XState v6 migration specification

Status: PR #20 merged. The follow-up [v6 design review](xstate-v6-design-review.md)
records source-level applicability and future review requirements.
Inventory baseline: DUI `eaf1b98`; pre-migration specification commit: `b8a52c2`.

## Purpose and scope

Adopt XState v6 beta while preserving SwipeActions behavior and its public Svelte
API. Use this small migration to validate conventions for the remaining repos.
Do not introduce Jazz, worker infrastructure, new presentation, or product copy
into DUI as part of this work.

The coordinated scope is delightful-ui, delightful-local-first (DLF),
delightful-clipper, and delightful-finances. local-first-ux-patterns is excluded.
Each repository gets its own reviewed specification before implementation.

## Pre-migration inventory

- `package.json` declares `xstate: ^5.33.3` as a runtime dependency, without an
  `@xstate/svelte` dependency.
- `src/lib/Components/internal/swipe-actions.ts` defines the single machine found
  in the current source inventory. It uses `setup`, type declarations, named
  guards/actions, `and`, `assign`, `enqueueActions`, transition arrays, and string
  targets.
- `src/lib/Components/SwipeActions.svelte` owns the root actor, subscriptions,
  pointer capture, measurement, browser listeners, and unmount cleanup.
- `src/swipe-actions.test.ts` covers machine behavior and server rendering;
  `tests/storybook/swipe-actions.spec.js` covers browser interaction.

Repeat the inventory at implementation start; other branches may add machines.

## Required behavior

1. Preserve taps, vertical scrolling, horizontal intent detection, pointer
   identity checks, direction reversal, disabled-action handling, and thresholds.
2. Preserve keyboard reveal, native button activation, Escape, outside click,
   focus handling, and accessibility semantics.
3. Preserve cancellation on resize, configuration changes, lost capture, window
   blur, and document hiding. Ignore stale dismissal completion after reset.
4. Emit `action.chosen` with the existing payload exactly once per accepted
   choice. Preserve the distinction between immediate button choice and full
   swipe dismissal completion.
5. Preserve compatibility-click suppression and reset behavior. Ordered context
   changes must remain visible at the same decision and notification boundaries.
6. Keep DOM resources and the interaction machine on the UI thread. The mounting
   component owns actor creation and disposal; no listeners, subscriptions,
   observers, or pointer capture may survive unmount.
7. Preserve SSR imports/rendering without requiring browser globals during module
   evaluation. Public component props and callbacks remain compatible.

## Authoring and dependency decisions

- Record and pin an exact v6 beta and codemod version when implementation begins;
  resolve published versions then rather than embedding an unverified version now.
- Express transitions using the v6 function model, immutable context patches, and
  queued effects. Keep predicates and reusable transformations descriptively
  named so branches remain readable. Do not turn transitions into procedural
  workflows hidden in helpers.
- Use v6 type-only schemas for existing internal TypeScript contracts unless a
  concrete runtime validation boundary warrants a schema dependency. Adding Zod
  is not required by this pilot.
- Review action ordering explicitly: multiple v5 assignments cannot be replaced
  by independent calculations over an unchanged context when later work depends
  on earlier updates. Audit emitted payloads and eventless transitions in particular.
- Preserve existing browser effect ownership. New v6 capabilities do not justify
  changing lifecycle architecture or adopting a framework binding unnecessarily.
- Prefer a complete conversion of this one internal machine. Use side-by-side
  installs only if an actual consumer boundary requires them; v5 and v6 actor
  references must not be assumed interchangeable.

## Implementation sequence and acceptance

1. Record the exact dependency/tool versions, base commit, machine export, inputs,
   and existing expected outcomes before transformation.
2. Capture a v5 codemod baseline with representative explicit event sequences and
   input. Include pointer movement/release, cancellation, reset, and configuration.
3. Run the pinned codemod in dry mode. Review its manual-site report before
   applying it to the machine and affected consumers; no broad repository rewrite.
4. Complete manual conversion and review all relevant runtime behavior changes in
   the official migration guide, including final states, eventless transitions,
   IDs, effects, and stopped actors. Record applicability rather than assuming
   successful type checking proves equivalence.
5. Compare the migrated machine against the baseline and inspect the component's
   subscriptions, event delivery, and cleanup. Generated traces supplement the
   existing behavioral expectations; they do not establish DOM correctness.
6. Run `pnpm check`, `pnpm package`, the focused SwipeActions unit suite, and its
   Storybook browser suite. Verify keyboard, pointer, cancellation, dismissal,
   unmount and SSR behavior without CSS-value/class assertions. Record exact
   commands and outcomes in the implementation review.
7. Inspect the package output and declarations for accidental v5 references or
   new public actor types. Qualify a consumer using the resulting package before
   requesting publication. Publication is a separate authorized action.

Acceptance requires preserved behavior above, passing relevant checks, resolved
manual codemod sites, and a documented dependency/artifact compatibility result.
Rollback restores the prior package and lockfile together with the prior machine
and component changes. No data migration is expected for this internal UI actor.

## Follow-on specifications and Finance worker requirement

After this specification is reviewed, prepare DLF's compatibility/ownership spec,
then Clipper's migration spec and Finance's migration plus worker architecture spec.
Confirm shared-package consumers before fixing implementation order.

Finance must distinguish UI-thread interaction/presentation machines from worker
domain/data machines. Its spec must inventory placement per actor, typed cloneable
messages, session generations, subscriptions/projections, cancellation, drain and
termination, worker failure, and uncertain writes. Keep local durability distinct
from remote acceptance; moving realms must preserve account and transaction ownership.

The root Clipper checkout does not contain the requested Jazz patches. Concrete
reference candidates exist under `worktrees/delightful-clipper/worker-runtime`
(Jazz alpha.59 and DLF patches) and later Jazz worktrees (including alpha.60
patches). Before Finance design, identify the accepted commit and exact patch
lineage, inspect their runtime/protocol and qualification evidence, and reconcile
them with Finance's older worker limitations. Do not copy the first patch found
or treat the existing article-processing worker as the full runtime architecture.
Reusable lifecycle/storage changes belong in DLF where appropriate; Finance
domain machines remain Finance-owned. Stage XState conversion and worker adoption
separately so behavior can be reviewed after each.

## References

- [Official v5 to v6 guide, including codemod and runtime changes](https://stately.ai/docs/xstate/v6/xstate-v5-to-v6)
- [Official framework guidance](https://stately.ai/docs/xstate/v6/frameworks)

Recheck these sources against the pinned beta before implementation. The codemod
is migration assistance, not proof that all manual or behavioral changes are covered.

## Pilot implementation and verification

The runtime dependency and lockfile now pin `xstate@6.0.0-beta.1`. The official
`@xstate/codemod@0.1.0-beta.1` was run in dry mode and then applied to the machine.
It reported no manual sites, but static review and `pnpm check` identified two
generated-code issues: emitted events need a schema map, and the generated
context-patch helpers did not satisfy v6 action-source signatures. The helpers
are now typed pure functions outside `setup`; transitions explicitly apply them.
Independent patches compose directly; dismissal computes the choice before its
exit offset. Notifications use `enq.emit`. No component changes were required.

The test harness uses `Actor<typeof swipeActionsMachine>` for owned actor roots:
v6's `ActorRefFrom` does not include root lifecycle methods such as `stop()`.
Existing assertions and browser tests were retained without weakening expectations.

Relevant runtime-change review: this machine has no parallel regions, invoked
children, timers, persisted snapshots, final-state output, or asynchronous action
promises. Its `dismissal.complete` state intentionally remains non-final, preserving
RESET handling. Named root IDs, eventless transitions, emitted-event timing,
immutable patches, and component-owned cleanup remain relevant. Mounts create
fresh actors instead of attempting to restart stopped roots. Existing browser
and unit coverage exercises interaction, cancellation, reset and dismissal.

Verification completed:

- `pnpm check`: zero errors and warnings.
- `pnpm package`: declarations, package generation, and publint passed.
- `pnpm exec vitest run src/swipe-actions.test.ts`: 26 passed, including SSR.
- Storybook production build with `tests/storybook` configuration: passed.
- Focused Playwright suite against that build: 73 passed, 11 existing conditional
  skips across desktop Chromium, mobile Chromium, and mobile WebKit. Native CDP
  touch tests run in mobile Chromium; skips do not establish native WebKit touch coverage.
- Codemod comparison: 100 seeded random sequences, 3,100 steps, no differences,
  missing event cases, unstubbed actors, or nonserializable values. The bundled
  baseline runtime is v5.33.4, whereas this repo previously locked v5.33.3.
  Shortest-path traversal reached its context graph limit; simple paths were
  explicitly disabled. This is sampled equivalence, not exhaustive proof.
- `pnpm pack --out /tmp/delightful-ui-xstate-v6.tgz`: passed. An isolated temporary
  consumer imported `SwipeActions` from the extracted package's public export
  and rendered its supplied link/action through Svelte SSR. The consumer reused
  installed dependencies; this does not qualify every downstream application's build.
  The Vite middleware harness printed an EPERM warning for an incidental HMR
  socket; SSR assertions completed successfully without that socket.
- Changed-file Prettier and Git whitespace checks passed. The current ESLint
  configuration skips standalone TypeScript files, so its invocation provides
  no additional TypeScript lint coverage.

To reproduce the sampled comparison, extract the original machine from `b8a52c2`
to a temporary `.ts` file, then run these commands from the repository root:

```sh
pnpm dlx @xstate/codemod@0.1.0-beta.1 baseline /tmp/dui-swipe-v5.ts \
  --input docs/xstate-migration/input.json \
  --events docs/xstate-migration/events.json \
  --out /tmp/dui-swipe-baseline.json --no-simple-paths \
  --walks 100 --steps 30 --max-sequences 100 --json
pnpm dlx @xstate/codemod@0.1.0-beta.1 verify \
  --baseline /tmp/dui-swipe-baseline.json \
  src/lib/Components/internal/swipe-actions.ts --json
```

The large generated trace is temporary; the input/event fixtures and reproduction
instructions are retained here. No package publication or downstream dependency
updates are included in this PR.
