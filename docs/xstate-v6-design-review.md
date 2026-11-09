# XState v6 design review

Source baseline: main `a8fd11f`, after migration PR #20. Reviewed 2026-11-09.
This follow-up is documentation only; it does not rerun or extend the historical
unit/browser evidence recorded in the migration notes.

## Version and evidence

Use `xstate@6.0.0-beta.1` without patches or declaration overrides. Read its
installed `docs/index.md`, `docs/agents.md` and `docs/api-stability.json`, then
its execution, transition, choice, state-input, typestate, lifecycle, selector
and testing guides. These identify the release's actual behavior and stability.
The [v6 agent guide](https://stately.ai/docs/xstate/v6/agents) and
[execution model](https://stately.ai/docs/xstate/v6/how-xstate-runs-machines)
explain why a passing codemod/type check is only the start of review.

## SwipeActions applicability

Review `src/lib/Components/internal/swipe-actions.ts` with the mounting
`SwipeActions.svelte`, including the functions passed into emitted-event listeners.
The chart remains UI-thread owned; pointer capture, measurements, focus, DOM
animations and accessibility state are Window capabilities. A worker adds no
ownership benefit for this interaction. There is no native transaction, timer,
parallel region, persisted actor tree or invoked request in this chart.

- Transition calculation uses pure predicates and context transformations. Keep
  native calls, time/random reads and component callbacks outside that calculation.
  Reject invalid pointer/action events before enqueueing or returning a patch.
- Dismissal computes its selected action before the exit offset; emission uses
  that selected payload exactly once. Do not simplify staged calculations into
  independent patches evaluated against old context.
- `dragging.revealing` and `dragging.armed` can remain resident. Their conditional
  `always` transitions intentionally have a no-transition case. `restoring` updates
  context, and `chosen` runs an emission. None should be mechanically converted
  to an effect-free, always-resolving choice node. See [choice constraints](https://stately.ai/docs/xstate/v6/choice-states).
- `DISMISS_COMPLETE` originates from the component's animation completion, so it
  remains public. Declaring it internal would reject the DOM owner's delivery.
  There are no machine-only raised coordination events to hide currently.
- State input and typestates are useful when they remove invalid combinations,
  not mandatory syntax. Pointer coordinates/configuration and click suppression
  participate across state transitions; do not move them to state input without
  accounting for release, reversal, cancellation, reset and notification lifetime.
- Context freezing includes consumer-supplied plain data. The component copies
  action configuration before sending it; preserve that boundary and SSR imports.
- `dismissal.complete` intentionally remains non-final: RESET is still accepted.
  Final entry/exit actions themselves are supported in v6; final states cannot
  handle events or start invoked work. See [final states](https://stately.ai/docs/xstate/v6/final-states).

No blocking rewrite was identified by this source audit. This conclusion does
not expand the existing browser/platform qualification. Keep the existing public
Svelte API and its tested native interaction behavior.

## Mount, subscriptions and failure ownership

The component creates a fresh actor per instance, reads its initial snapshot,
subscribes on mount, and owns pointer/listener/subscription disposal before stop.
Review reattachment/unmount together with delayed animation completion: no old
completion may choose an action on a new or reset interaction.

Do not replace the snapshot subscription with `actor.select` without reading
`selection.get()` for the initial render and preserving cleanup; its subscription
does not replay the current value. A narrower subscription is useful only when
measured rendering work warrants it. See [selectors](https://stately.ai/docs/xstate/v6/selectors).
Define error handling at the component boundary if new fallible effects are added;
passive subscriptions do not constitute actor error supervision.

## Requirements for subsequent PRs

Keep literal target returns and descriptive predicates. Runtime graph extraction
does not enumerate function bodies, so do not claim a complete graph from a
visualization. Treat definition serialization and live snapshot persistence as
separate features; neither is needed for this component.

For future code changes, retain pointer/keyboard/SSR/accessibility coverage and
include rejected/duplicate events, cancellation-before-completion, old-snapshot
immutability and no effects during `can`/pure transition evaluation. Use native
DOM/resource tests where pure transitions cannot represent the boundary. Preserve
the recorded browser skips and sampled-codemod limits instead of calling them
exhaustive evidence.

Coordinated adoption remains DUI → DLF → Clipper/Finance by complete connected
actor graphs. Independent DUI roots do not permit passing v5 refs into v6 actors.
local-first-ux-patterns remains outside the migration.
