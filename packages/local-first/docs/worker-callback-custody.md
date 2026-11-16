# Worker callback and response custody

F4c1 extracts the existing channel's native callback/resource keeper into the
public `delightful-local-first/worker/callback-custody` subpath. The existing
worker channel consumes it; Finance's bounded grant population is the next
consumer. The user approved the concrete implementation and its qualification
on 2026-11-14; the qualification below passes.
The user selected this shared extraction on 2026-11-14 instead of a separate
Finance keeper. It adds no SDK patch, actor root, timer or native listener.

## F4c2 callback interruption extension

PR #37 is merged at main `4301afde`. The user separately approved F4c2's concrete
implementation/tests on 2026-11-14. The slice is qualified on
`feat/finance-worker-grant-population`; the F4c1 results below remain historical.

The future SDK bridge can know a callback was interrupted without having received
its broker wire sequence. It must not fabricate that identity or label an issued
write not issued. `WorkerCallbackInterruption` supplies a separate required-field
variant: `kind: interrupted`, `reason: closed | unavailable`, and
`effectOutcome: not-issued | unknown`. It has no successful response or wire
identity and cannot serve as native host-close output.

Keeper/result/registration/stop-result types and the factory accept an optional
third type parameter constrained to this variant. Its default is `never`, keeping
existing consumers' exact channel-result contract. Opt-in consumers use
`WorkerCallbackResult<Response, WorkerCallbackInterruption>`; real broker results
retain their actual wire identity. The native custody algorithm, chart ownership
and channel wire protocol are unchanged. Charts still select/record stop outcomes
before effects; the keeper only stores and delivers them.

F4c2 passes all 1,198 library tests, including 24 direct custody cases and native
accepted-port survival. All four actual-tarball consumers pass public types,
native runtime checks and module-worker builds; the custody fixture covers both
unchanged default result types and opt-in unknown/not-issued outcomes. Finance
passes 2,104 units, 184 focused host cases, 18 worker-state and 21 native cases;
Clipper passes 872 units, 30 component cases and all 32 native worker cases. The
[F4c2 qualification record](../../../apps/finance/specs/013-local-first-startup/worker-grant-population-design.md#f4c2-qualification-on-main-4301afde)
owns commands, logs and qualification limits. Existing
production/offline F4c1 counts are not relabeled as new F4c2 results.

## Ownership

The channel/population chart selects admission, identity, limits, dispatch,
deadlines, faults, results and graceful shutdown. Call the native keeper only
from queued effects or native callbacks. It has no workflow states or actor refs.
Its private collections contain callback registrations and unaccepted responses;
its irreversible stop flag records whether this native keeper has been disposed.
It cannot reopen or retry an operation.

In particular, the chart supplies each registration's conservative stop result.
The public type excludes success. The existing channel now selects this result
in its accepting `REQUEST` transition before registration/dispatch, rather than
deriving it inside callback cleanup. Issued effects remain unknown on forced
stop; queries can be not issued. Neither result is a host-close receipt.

For a callback waiting for grant acquisition, the future population selects a
not-issued stop result. Before forwarding an operation that may issue an effect,
it records the appropriate conservative result through `recordStopResult`.
This records a selected result; the keeper does not infer issuance from another
actor's state or reconstruct the population's lifecycle.

## Public API

| API                                               | Native responsibility                                                                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWorkerCallbackCustody<Identity, Response>` | Capture the supplied exact-identity comparator and synchronous response disposer; construct an empty private keeper.                                                                                                 |
| `register({ identity, settle, stopped })`         | Retain an already-admitted callback and its selected stop result. Duplicate live identities are a caller contract error. Registration after native stop immediately receives its supplied stop result.               |
| `recordStopResult(identity, result)`              | Replace a retained callback's selected non-success stop result before dispatch. A missing registration is unchanged.                                                                                                 |
| `capture(response)`                               | Retain an unaccepted response behind an opaque token. After native stop, dispose it immediately and return no token.                                                                                                 |
| `deliver(identity, result, token)`                | Deliver the chart-selected result to the matching callback once. Relinquish its transferred resource before calling out; dispose an unaccepted response when the callback throws.                                    |
| `discard(token)`                                  | Dispose a retained unaccepted response; missing tokens are unchanged.                                                                                                                                                |
| `stop()`                                          | Irreversibly stop native registration, discard unaccepted responses and deliver each retained callback's selected stop result. Reentrant/repeated stop does not restart cleanup or double-settle detached observers. |
| `deliverWorkerCallback(settle, result, discard)`  | The existing native observer-delivery leaf, also used for chart-selected immediate refusals without a registration.                                                                                                  |

Identity values are immutable admitted observations. The comparator must be pure.
The keeper copies registration fields and stop-result envelopes and captures its
native function capabilities. It does not validate untrusted wire frames.
Native disposer errors propagate and failed resources remain retained in the
keeper; cleanup is not a successful native-close proof. Stop attempts each
retained resource once and settles detached observers even if a disposer fails.
It reports disposal failures through an exception after that unconditional
cleanup batch, rather than silently dropping the remaining callbacks. The owner
must retain the keeper through incomplete cleanup; stop does not retry it.

This API provides no producer queue and no admission limit of its own. The caller
must bound registrations and retained responses before effects. The existing
channel retains its eight-call admission/FIFO protocol. The future Finance owner
must enforce 32 grants, eight aggregate callbacks and 1 MiB before acquisition
or dispatch, including callbacks waiting for a grant. Extracting the keeper does
not establish those population guarantees or solve SDK-before-grant drain.

## Integration and qualification boundary

The channel root constructs and retains the keeper; its data invocation now
delegates registration, capture, delivery, discard and stop to that same object.
This keeps incomplete resource custody reachable even if the data/controller
child fails. Successful final entry clears the root's native capability.

The controller now has an explicit `releasing` state after its genuine host
receipt and issued-request settlement. It commands one unconditional native data
listener/keeper cleanup batch, then consumes a correlated `CUSTODY_RELEASED` or
`CUSTODY_RELEASE_FAILED` fact. Only release success reaches final output; failure
reaches `blocked` and retains the root's keeper. The native adapter caches its
actual release result, so a repeated cleanup cannot turn failure into success.
Forced stop runs the same native cleanup but emits no successful-close output.

Wire decoding, resource tokens in chart reports, request children and independent
close-control ownership retain their existing boundaries. The root and
owned-child broker consumers continue through that channel; Finance and Clipper
need no facade change. This is a shared lifecycle change requiring behavioral
qualification, not only a file move.

The pre-test review covered the helper, the `REGISTER` command's selected stop result,
the channel's queued effects, the public export and the
[Finance population handoff](../../../apps/finance/specs/013-local-first-startup/worker-grant-population-design.md).
The approved qualification plan required direct keeper and
real channel/broker coverage for exact identity, duplicate registration,
stop-result recording, synchronous/late delivery, a throwing observer, reentrant
stop, failed-disposer retention/continued cleanup and accepted-port survival.
It also required a packed public-subpath consumer, Finance's native grant
fixtures and Clipper's existing broker consumers. The approved results below
qualify those ownership/race cases separately from static checks.

Prepared static checks pass on the PR #37 branch with main `434a06ee` and the
F4b checkpoint `868e1e32`: library types and changed-source Oxlint/Oxfmt, both
library packages with strict publint, existing public-consumer declaration types,
Finance app/service-worker/host/proof types, Clipper coordinator/web/service-worker/
extension types, and the production Finance worker import build. App checks report
zero errors/warnings. The built worker renders both keeper functions from the
injected Local First package (3,507 bytes for the module). Peer-link/guidance and
whitespace checks pass. Logs are `/private/tmp/finance-worker-w05-f4c1-*.log`;
the final source/package/type/build results use the `final-` filenames.

The initial lint pass on the cleanup correction rejected throwing from a
`finally` block and the inline snapshot iteration. Cleanup now collects native
failures, delivers callbacks before propagating them, and explicitly snapshots
tokens before disposal so reinserting a failed resource cannot repeat the loop.
No lint rule was disabled. These are static/source-review results only; no F4c1
implementation tests were added or run before review. The aggregate population,
actual callback bridge and acquisition transport remain subsequent work.

## Approved qualification

Qualified on `feat/finance-worker-grant-owner`, against refreshed main `434a06ee`
and F4b checkpoint `868e1e32`, using Node 24.22.2/pnpm 10.28.0:

| Scope                    | Result                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local First units        | All 1,192 tests in 57 files; 18 new keeper cases and four new channel cases.                                                                                                                                                                                                                                                          |
| Focused native ownership | All 109 keeper/channel/broker/owned-broker/close cases in five files, including the existing 400-sequence channel oracle, seed 20261113, up to 24 commands.                                                                                                                                                                           |
| Packed public API        | Four actual-tarball consumers: callback custody, native close, root broker and child-owned broker. Strict public types, native effects/receipts and self-contained production ES-module workers pass.                                                                                                                                 |
| Finance                  | All 2,082 units in 148 files (including 15 real worker-build proof cases), 163 focused host cases, 18 worker-state cases including 400 grant-owner sequences (seed 20261114, up to 24 commands), 21 native cases across Chromium/Firefox/WebKit and all 19 production PWA/provider-worker cases.                                      |
| Clipper                  | All 872 units and 30 component cases; all 32 worker, 12 packaged-extension and eight production-offline cases. Offline coverage retains full stopped-endpoint browser restarts, local edits and reconnect.                                                                                                                            |
| Static/package           | Library/test and public-consumer types, changed-source formatting/lint, both library packages with strict publint, Finance app/service-worker/native-fixture/model/proof types, Clipper coordinator/web/service-worker/extension types, production builds, peer links, guidance and whitespace. App checks have zero errors/warnings. |

Keeper cases cover immutable registration/stop-envelope capture, exact identities,
duplicate rejection, recorded unknown effect outcomes, observer failure,
reentrant/repeated stop, attempted cleanup of every retained resource, original
failed-stop preservation and a real accepted port remaining usable after stop.
Channel cases additionally require native data cleanup before output, reject a
genuine host acknowledgement as completion when local cleanup fails, settle all
issued callbacks after orphan-disposal failure and distinguish reentrant forced
stop from successful close. These bounded/generated and native checks do not
prove every platform schedule.

The initial focused run passed 49/56 and found two distinct problems:

- Six new opaque-port assertions overflowed Vitest's deep comparison. They now
  require the exact call count and response-object identity, with real-port
  survival checked separately. No native assertion was weakened to a structural
  substitute.
- An orphan response's throwing disposer caused the native callback actor to
  fail before its pending observers were settled. The diagnostic witnessed the
  controller in `blocked`, no live data child and zero callback settlements.
  Native receive/listener boundaries now report a sanitized transport failure
  instead of throwing out the data owner. The existing chart drains issued work,
  retains independent close control and then consumes its typed release result.
  A failed release remains blocked with no close output. No XState/SDK patch or
  second owner was introduced. All 56 keeper/channel and 109 focused cases pass
  with the fix; complete permitted unit/native/browser runs pass on their first
  runs after that correction.

The first elevated test launch did not start: automatic approval review timed
out without a safety finding. A normal-sandbox alternative passed 1,121 cases
but could not bind the three Jazz fixture suites (71 skipped), so it is not a
qualified full run. The subsequent permitted launch passes all 1,192, with none
skipped. The initial failures/diagnostic and qualified results remain separate
under `/private/tmp/finance-worker-w05-f4c1-*.log`.

Reproduction commands: Local First `pnpm test:unit --run` and
`node fixtures/package-consumer/worker-host-close-packed.mjs` after packaging;
Finance `pnpm test:unit --run`, `pnpm test:worker-host`, `pnpm test:worker-state`,
`pnpm test:worker-bindings`, same-origin ephemeral `FINANCE_PREVIEW=true pnpm build`
and `pnpm test:pwa`; Clipper `pnpm test:unit`, `pnpm test:worker`,
`pnpm test:extension` and `pnpm test:offline`. Logs ending in `library-unit-permitted`,
`focused-qualified`, `packed-consumers`, `finance-unit`, `finance-host`,
`finance-model`, `finance-native`, `finance-pwa` and the four `clipper-*` suite
names preserve the qualified results. Final static logs use `qualified-*`.
