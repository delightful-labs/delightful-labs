# Native XState event routing review

The user requested cleanup of PR #26's forwarding helpers and a repository-wide machine review.
This continues the authorized implementation/test work on that PR.

Use XState 5.33.2 `forwardTo` for unchanged commands and `sendTo` for translated commands. Scope
sends to states that invoke the recipient. Ancestor handlers retain interruption facts when no
command-capable child exists; state-specific handlers include those same actions explicitly.
Normalize release/identity reports once with raised control events. Promise leaves cannot receive
commands: their owners latch interruption, collect settlement and clean up. No actor is stopped or
restarted merely to cancel a side effect.

Parallel machines already separate control from work. Route accepted commands from the invoking
work state, using the existing control-state guards to preserve cancellation/shutdown precedence.
Observation updates use the existing OBSERVATION_CHANGED event in each active region. No additional
public or internal command protocol is needed. Preserve generation/scope guards. Do not replace actual optional-recipient
checks, external-owner health checks, or SDK callback bridges just to remove enqueueActions syntax.

Review production machine modules and fixture statecharts for manual child lookup/status routing,
forwarding to promise leaves, needless enqueue wrappers and parent/child lifecycle assumptions.
Inspect both already-native handlers and custom helpers. Avoid unrelated workflow redesign or a
new dispatcher/registry. Verify settled-child races and parallel delivery at existing boundaries.

Primary references researched before this cleanup:

- [XState send actions](https://stately.ai/docs/actions#send-to-action)
- [Explicit event delivery in v5](https://stately.ai/docs/migration#send-events-explictly-instead-of-using-autoforward)
- [Promise actor capabilities](https://stately.ai/docs/promise-actors)
- [Invocation lifecycle](https://stately.ai/docs/invoke#lifecycle)

Small probes against installed 5.33.2 confirmed that nested handlers replace ancestor handlers,
forwarding to an absent named child errors, and native sends preserve the child while it drains.

## Repository audit

Reviewed the event-routing topology of all 45 machine-bearing modules: the 35 shared statechart
modules and 10 notebook fixture statechart modules (47 statecharts and 146 invocation sites). Also inspected the five shared support modules
(feedback projection, form lifecycle/policy, native journal and transaction custody), the notebook
continuation factories and SDK callback adapters. This is an actor communication/lifetime review,
not a claim that unrelated domain algorithms need rewriting.

| Area                                                                     | Changes / review outcome                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notebook workflow, preparation, continuation                             | Native state-scoped sends to planning/write children; RELEASE and identity reports normalize once with raise. Journal and read leaves retain interruption in their owner.                                                                                                    |
| Notebook preparation, attachment, root, note and activation destinations | Only the writing state forwards controls to its identity/staging child. Reads drain without ineffective messages to promise actors.                                                                                                                                          |
| Shared restore coordinator/write owner                                   | Native sends in the states invoking write/destination; lock failure requests shutdown only while the writer is owned. Journal, transaction acquisition/commit/settlement/rollback remain draining leaves.                                                                    |
| Export/capture/envelope/inspection                                       | Export now sends directly in capture/seal states and retains its native host abort. Capture/envelope/inspection already expose explicit ownership and native sends; no redesign.                                                                                             |
| Restore journal, journal step, operation lock, export cleanup            | Already use explicit native commands and resource lifetimes; retained.                                                                                                                                                                                                       |
| Form readiness/submission/write                                          | Direct native observation/control delivery. Known promise-only persistence receives no command messages. Optional progress recipient and watch-only delivery keep their actual conditional enqueues.                                                                         |
| Scoped form                                                              | Parallel regions consume the existing observation-change event and send to the children they own. Submission controls are scoped to active submission.                                                                                                                       |
| Avatar save                                                              | Processing/saving states send controls directly. Existing parallel control states gate repeated cancellation, shutdown upgrade and scope-loss observations.                                                                                                                  |
| Session attachment/acquisition                                           | Single-recipient messages use sendTo; dynamic acquisition reply fan-out retains enqueueActions. External-owner subscription/health checking remains necessary.                                                                                                               |
| Workspace creation operation                                             | Journal/persistence states forward accepted controls directly. Parallel control guards keep duplicate suppression and shutdown precedence. Promise validation/reconciliation leaves only drain.                                                                              |
| Workspace startup                                                        | Retained seed health check: a stopped/failed seed may no longer produce a completion acknowledgement, even while its parent is still ready. This is a demonstrated completion race, not an existence lookup to simplify away.                                                |
| Form write readiness assessment                                          | Retained error/generation correlation: an older crashed readiness actor can report after a replacement assessment. A direct event.error alone does not identify which generation failed.                                                                                     |
| Remaining identity and workspace machines                                | Profile persistence/composition, avatar selection, recovery phrase, restoration/recovery/readiness, creation owner/persistence/transaction, workspace selection/naming/initialization/invitations/journal already use native state-scoped sends or require no child routing. |
| Native resource bridges / root shutdown utility                          | Retained subscription cleanup, detached transaction custody, and public actor-health checks at host boundaries. They serve different lifetimes from invoked-child routing.                                                                                                   |

The only remaining internal child snapshot reads are the qualified workspace seed race and form
assessment failure correlation. No production forwarding helper looks up child lifecycle status.
No registry, bus, new supervisor, retry or stop/restart cancellation was introduced.

## Qualification — 2026-11-05

Changed 19 implementation modules and added four regression cases: avatar cancel-to-shutdown upgrade,
scope replacement during image processing, scope loss/shutdown during an active save, and workspace
journal cancel-to-shutdown upgrade. They verify actual child-directed messages, duplicate suppression,
retained child lifetime, final settlement and resource clearing at existing actor boundaries.
The public actor event types, state topology, output contracts and transaction ownership are preserved.

Final local results:

- `pnpm verify`: 927 units in 39 files; formatting/lint/Svelte/TypeScript, strict package/consumer
  checks, 17 independent-reader cases, 18 notebook export cases and Storybook build pass.
- `pnpm check:backup-restore`: all 60 actual Jazz/Chromium cases pass. The three optional size
  measurements remain separate; the earlier performance report records their measured baseline.
- `pnpm test:storybook`: all 65 cases pass.
- Private-creation TypeScript check and native suite: all 10 cases pass.
- `git diff --check` passes. No implementation test expectations were weakened.

Total: 1,097 functional cases. The first unrestricted unit attempt could not bind two disposable
Jazz servers inside the sandbox; the full authorized run with local-server permissions passed.
No production data, identity/storage settings, deployment or dependency versions changed.
