# Grant population: callback custody decision

Status: researched proposal, awaiting discussion; no F4c implementation or test
approval is claimed. Continue on [draft PR #37](https://github.com/delightful-labs/delightful-labs/pull/37).
Remote `main` was refreshed on 2026-11-14 and remains `434a06ee`; the qualified
F4b branch checkpoint is `868e1e32`.

The [single-grant design](worker-grant-owner-design.md) remains authoritative for
F4a/F4b. This record makes the next callback ownership decision explicit before
implementing the aggregate population. It does not change the selected SDK
callbacks, exact grant bindings, limits or SDK-before-grant shutdown order.

## What the next owner must do

Invoke one population before SDK acquisition. Its chart admits SDK callbacks,
joins an existing exact grant or spawns one `createFinanceGrantOwner()` child,
and dispatches each admitted operation once after `GRANT_AVAILABLE`. It retains
failed identities until the runtime ends. A late pair after retirement must
follow the existing child's close path, never become available again.

The population enforces 32 retained grants, eight outstanding callbacks across
all grants, and 1 MiB of aggregate encoded pending request payloads before native
effects. Calls waiting for acquisition count toward both callback limits. The
implementation must define the encoded representation and keep reservations
until actual settlement; per-channel eight-call bounds alone are insufficient.

| Population state | Selected behavior                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Accepting        | Validate and copy SDK input; admit bounded calls; join/acquire an exact grant; forward only through an available grant.        |
| Faulted          | Refuse new native effects; report the fault; settle waiting calls as not issued; retain already-issued work and grant custody. |
| Draining         | After actual SDK closure, refuse new callbacks and retain original issued settlements and late acquisitions.                   |
| Closing          | Retire retained grants and wait for their original definitive non-allocation or matching host-close outputs.                   |
| Blocked/overdue  | Report incomplete cleanup and keep observation alive; a deadline or stopped child is never a closure receipt.                  |
| Closed           | Every owned acquisition and callback is settled and every acquired grant has a genuine close output.                           |

After any failed generation read/write, the population must fault admission
before releasing that callback's rejection to the SDK. The installed SDK catches
these errors; its fallback must not authorize another native open. This ordering
needs a real SDK acceptance case, including a read fallback and a write fallback.

## The concrete custody gap

An SDK callback may already have returned a promise while its grant is still
being acquired. Keeping its resolver only in population context is insufficient:
forced stop/error does not run ordinary drain transitions. That promise needs an
explicit terminal rejection path too.

After dispatch, a successful open also returns a live MessagePort. Passing that
port through an event to a stopped/error actor does not establish acceptance.
If reporting fails or the recipient stops before delivery, some native owner must
still hold and dispose the unaccepted port. A fulfilled SDK open transfers its
port to the SDK; later grant closure must preserve that accepted port.

These are native callback/resource obligations, distinct from retry, admission,
readiness and shutdown policy. Those decisions remain visible in the charts.
Neither option below starts an actor inside an SDK promise or patches Jazz.

## Existing code and reuse

- Local First's [worker channel](../../../../packages/local-first/src/lib/machines/lifecycle/worker-channel.ts)
  already registers native observers before dispatch, retains returned resources
  under private tokens, and delivers or discards them on the chart's command.
  Its callback disposer settles outstanding dispatched observers when stopped.
  This machinery is private to `createChannelController`; there is no public
  callback-custody API for calls waiting for grant acquisition.
- Its [broker adapter](../../../../packages/local-first/src/lib/backend/jazz/worker-broker.ts)
  validates operations through `brokerHostCall` and invokes that same channel.
  Its existing root facade settles SDK promises directly. The population must
  preserve this native ownership contract while adding aggregate admission and
  failure-before-SDK-fallback ordering.
- Local First's [transaction custody](../../../../packages/local-first/src/lib/machines/workspaces/transaction-custody.ts)
  retains transaction/acquisition/commit promises for detached recovery. It does
  not provide bounded SDK callback registration or unaccepted MessagePort
  delivery, so it is not a drop-in replacement.
- Clipper consumes the shared broker/channel through its existing root facade.
  Refactoring that machinery therefore requires Clipper regression coverage,
  even though Finance's population is the new consumer.

## Two supported approaches

### A. Extract the existing native callback custody into Local First

Expose a small typed native primitive based on the channel's current observer/
resource keeper. Use it in the existing channel and for Finance's callback bridge.
The population chart remains the sole owner of admission, dispatch, fault and
graceful-close decisions. The primitive retains callbacks/ports, performs selected
delivery/disposal, and has an explicit stop/error handoff.

This is the recommended direction because the existing channel and the new
bridge need the same custody guarantees, and the user requested reusable
mechanisms in Local First. It requires a shared refactor and qualification of the
existing broker facade, packed public exports and Clipper before adoption.

### B. Keep the shared channel unchanged and add a Finance SDK bridge keeper

Add a native adapter specifically for the existing `browserWorkerHost` promise
methods. It retains callbacks waiting for acquisition, handles their stop/error
settlement, and accepts returned resources from the unchanged shared channel.
The population chart still chooses admission and outcomes. Generic extraction
would be a later review if a second consumer needs that adapter.

This keeps the next production-code diff within Finance, but introduces another
callback keeper alongside the library's existing implementation. It needs its own
ownership and reentrancy evidence. It must not become a second native workflow
or copy the broker's wire decoder, FIFO or close policy.

## Required detail after choosing

Before implementation, specify the narrow typed API and these boundaries:

1. Callback custody exists before forwarding a request, including synchronous
   reports/reentrancy. Overload refusal cannot leave an unresolved promise or
   create an unbounded native callback inbox beside the chart's eight-call limit.
2. Native callback registration and resource tokens are receipt bookkeeping.
   Admission, original deadlines, retries, fault selection and graceful shutdown
   remain statechart decisions; no mirrored lifecycle flags in the keeper.
3. A native result remains owned until actual SDK acceptance or selected disposal.
   Stop/error during reporting or delivery must not lose a port or double-settle
   a callback. Generation failure reaches the population before SDK fallback.
4. Correlate grant replies with all three identities and preserve offered pairs
   until `GRANT_ACQUIRED`. The future acquisition transport retains unaccepted
   and contradictory replies, with explicit disposition and alias protection;
   they are not forwarded into completed children.
5. Forced stop/error is disruptive settlement, never successful SDK or grant
   closure. Unknown issued writes are not replayed or relabeled not issued.

Then implement one bounded slice for review before its tests. Qualification must
cover aggregate limits across multiple grants, duplicate acquisition, both SDK
generation fallbacks, synchronous/late replies, observer failure, stop during
acquisition/result delivery, accepted-port survival and SDK-before-grant closure.
The population, transport and actual SDK/session composition remain incomplete.
