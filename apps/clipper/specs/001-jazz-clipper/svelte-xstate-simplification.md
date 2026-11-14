# Svelte and XState integration simplification

Status: Implemented and qualified in PR #31. See the
[completion review](svelte-xstate-completion.md) for final decisions, ownership,
source/native evidence and limits, and the
[completed checklist](svelte-xstate-simplification-tasks.md). The initial research
and alternatives below are retained as design history. This document supplies no
additional dependency, policy-exception or release authorization.

## Problem and intended result

[PR #21](https://github.com/delightful-labs/delightful-labs/pull/21) replaces a
reader interface with roughly 30 props with smaller components and snippet
composition. It also moves substantial coordination into the reader route.
Library, Add Link, tag editing and reader integrations repeat subscription,
initial-snapshot and disposal code. Drawer components repeat viewport observers.

Use native Svelte features and published XState integrations to reduce that
plumbing. Components should reveal presentation and user intent; resource owners
should be easy to locate. Reduce custom lifecycle machinery where standard
invocation, cancellation and cleanup already meet the actual requirement.
Do not move complexity into an opaque controller or add a general framework.

## Scope and boundaries

Start with selector observation and lifecycle research, then one component pilot.
Broader composition, attachment and drawer cleanup follows the qualified pilot.
Application/domain actors, SDK work and expensive projections remain in workers;
DOM, focus, viewport and component-owned UI actors remain on the main thread.
Preserve local-first readiness, account scoping, dedicated reader URLs, existing
copy and DUI presentation. This is not an XState version migration, persistence
rewrite or redesign of authentication/extension capture.

Shared [state-machine guidance](../../../../docs/engineering/state-machines.md),
[Clipper XState memory](../../docs/memory/xstate.md) and
[worker boundaries](../../docs/memory/worker-runtime.md) remain binding for
implementation. Their architecture claims may be audited. If evidence supports
changing a required policy, propose the exact policy amendment with its rationale
before the dependent implementation. Preserve historical qualification records.

## Research established so far

The investigation inspected installed package docs and executable source, rather
than assuming current online examples match the pinned beta.

| Finding | Consequence |
| --- | --- |
| Clipper uses `xstate@6.0.0-beta.1`; `@xstate/svelte@6.0.0-beta.0` exists in the workspace but is not a direct Clipper dependency. | Recheck pins before implementation; obtaining a workspace package does not authorize adding it to Clipper. |
| Core `actor.select(selector, equalityFn?)` exposes `get()` and `subscribe()`, compares with `Object.is` by default, and does not replay the current value on subscription. | A Svelte store adapter must supply an initial value and reread on subscription. It cannot simply expose the core readable as a Svelte store. |
| Installed `useSelector` accepts structurally compatible `getSnapshot()` and `subscribe()` methods, returns a Svelte readable, and defaults to `===`. | A thin adapter can connect `LibraryClient.getView()` and its subscription to the existing binding. No fake actor or additional machine is required. |
| Installed `useSelector` rereads on subscription, observes changes and releases its upstream subscription when the store loses its subscribers. | Prefer ordinary `$store` reads over repeated component snapshot plumbing. Its captured source does not automatically follow a replacement client. |
| Installed `useActorRef` starts immediately and calls `.stop()` on component destruction; `useActor` builds on it. | Use where component lifetime really owns actor lifetime. Observe shared resources without acquiring lifecycle ownership. Review SSR behavior before adoption. |
| The current client callback cleanup terminates its Worker. Host shutdown first drains work and closes the SDK session/bridges. | Replacing this root with automatic stop is not mechanically equivalent. Whether all existing coordination is needed remains unproven by this investigation. |
| Worker messages clone object identities. Existing reader revisions avoid retransmitting some immutable content. | Selecting whole objects will often still notify; narrow primitive selections or explicit semantic comparisons are needed. UI selectors alone do not reduce worker projection or transport cost. |

An isolated executable probe confirmed initial reads, unrelated-update suppression
and unsubscription for core selection and a worker-shaped Svelte source. This
was not TypeScript, browser, real-worker or persistence qualification. No product
implementation changed. Error/completion propagation, replacement and SSR still
need investigation; do not infer them from the happy-path probe.

Primary references:

- Installed `xstate/docs/index.md`, `agents.md`, `api-stability.json`,
  `selectors.md`, `cancellation.md` and `lifecycle-and-errors.md`.
- Installed `@xstate/svelte/dist/xstate-svelte.js` and `useSelector.d.ts`.
- [XState Svelte bindings](https://stately.ai/docs/xstate/v6/svelte/use-machine)
  and [selectors](https://stately.ai/docs/xstate/v6/svelte/selectors).
- Svelte [stores](https://svelte.dev/docs/svelte/stores),
  [reactivity](https://svelte.dev/docs/svelte/svelte-reactivity),
  [context](https://svelte.dev/docs/svelte/context),
  [snippets](https://svelte.dev/docs/svelte/snippet), and
  [attachments](https://svelte.dev/docs/svelte/@attach).

## Required design decisions

### Observation and ownership are separate

Evaluate two approaches: the existing `useSelector` binding with a typed worker
source adapter, or a small native Svelte store/reactivity adapter with equivalent
selection behavior. Prefer the existing binding if its actual contracts fit.
Record dependency cost and limitations before selecting either. Do not build
custom selection infrastructure simply to avoid checking the supported package.

The adapter observes render DTOs and forwards typed intent. It must not start or
stop domain actors, terminate workers, reconstruct domain eligibility, or expose
private SDK/actor state. Keep the current client receipt-based admission behavior.
Retain useful type inference without casts, `any`, or fake actor identities.

Specify initial values, source replacement, subscription timing, teardown,
terminal/failure behavior and server rendering. A view must never temporarily
retain another account's data after binding invalidation. Use an existing keyed
client lifetime or an explicitly designed replacement mechanism, not both by
accident. No module-global account state or shared SSR actor is introduced.

Select the smallest meaningful render values. Object comparators must include
all fields affecting the consumer, including messages, permissions and locale.
Do not hide stale output through incomplete equality or universal deep equality.
Keep expensive projection in workers. Reader progress must not rebuild saved DOM.

### Audit shutdown rather than assuming it is good or bad

For every custom drain/acknowledgment/custody boundary, record:

1. The native resource, actor owner and actual lifetime.
2. The concrete operation already issued when cancellation arrives.
3. The pinned SDK/API's cancellation, settlement and close guarantees.
4. What standard actor stop/invoke cleanup does and does not guarantee.
5. The observable failure if the custom layer is removed.
6. A disposition: retain, simplify with standard APIs, consolidate, or unresolved.

Differentiate cancelable reads/UI observers from issued writes, final reader
position capture, SDK acquisition and session close. An abort signal only helps
when the underlying API honors it. Stopping an actor does not await asynchronous
storage settlement; a subscription's completion is not proof of durability.
Conversely, a custom close protocol is not justified by naming a hypothetical
race. Require SDK source/docs and independent failure evidence where possible.

Model any necessary orderly closure with ordinary XState states/invocations.
Use the fewest owners required by independent resource lifetimes. Do not demand
that every child implement an application-wide shutdown handshake.

Orderly navigation/sign-out/popup closure and abrupt tab/process termination are
different cases. Browsers do not guarantee asynchronous teardown at exit. Data
safety must survive abrupt termination; graceful close cannot be its sole basis.
Do not promise all writes survive a crash: distinguish admitted, locally durable,
remote-accepted and unknown outcomes. Never silently replay an uncertain write.

### Component composition follows responsibilities

After selecting the observation approach, reduce the reader route's subscription
and attachment coordination without recreating a giant reader interface.
Use snippets for caller-owned content/layout and small coherent data contracts
for presentation. Use typed context at scoped integration boundaries; retain
explicit props for reusable presentation. Do not replace prop lists with an
opaque all-purpose model or turn every presentation leaf into an actor consumer.

Evaluate `MediaQuery` for duplicate drawer listeners and attachments for DOM
surface setup/cleanup. Keep imperative focus methods where they express native
behavior. Prefer composition/reactive public state over reaching through
`getControl()`/`getDrawer()` chains. Generic drawer semantics belong in DUI.
Every extraction must remove a responsibility or duplicated contract, rather
than merely relocating markup. Keep native forms, anchors and accessible focus.

## Acceptance and evidence

- A pilot removes manual snapshot subscription boilerplate and preserves typed
  commands, first render and failure/reload feedback.
- Unrelated progress/status updates do not notify unrelated selected primitives.
  Object-selection claims include evidence of comparator correctness.
- Mount/unmount and account A → B → A replacement leave no old subscription or
  stale rendered account data. Stale intents remain rejected by the owner.
- Changing routes does not restart the application/session owner. Reader A → B
  → A disposes attachments exactly once and rejects late reports.
- Content selection/focus survives unrelated view updates. Drawer keyboard
  dismissal, focus return and modal inertness remain correct at both sizes.
- Any lifecycle simplification includes an evidence-backed before/after ownership
  map, native cancellation/settlement results and interrupted-close scenarios.
- Crash/restart checks distinguish durable edits from in-flight unknown writes;
  reopen the same offline library and verify reconnect without blind replay.
- Report changed files, removed duplication, affected checks and limitations.
  Source inspection and isolated probes are never reported as product validation.

No broad cleanup is required before the pilot can be reviewed. Implementation,
test execution and dependency approval follow the workspace's existing gates;
this draft is the concrete proposal for that review.
