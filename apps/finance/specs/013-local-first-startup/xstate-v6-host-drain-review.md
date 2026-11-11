# Finance native host-close receipt

## Focused implementation

The account-store operation graph retains the primary Web Lock after an uncertain
write. Its `draining -> releasing` transition requires an actual Window receipt;
a failed request port, client-side close, timeout, or worker cancellation is not
that receipt.

This batch adds an independent private control channel. The Window endpoint calls
the synchronous `serveWindowHost` disposer before replying. That disposer marks
the host closed and removes its request listener, so queued storage requests can
no longer execute. A request already executing in the Window completes before a
control message can execute in that same realm. The receipt makes no claim about
whether that earlier write committed.

The channel performs one native close request/acknowledgement, with scoped UUID
correlation. It does not choose identities, retry writes, select recovery policy,
or own an SDK shutdown workflow. Its pending correlation, timeout, and listener
cleanup are native resource bookkeeping; the existing operation chart owns the
business states and lock custody. No new promise actor hides a workflow.

The client exposes one idempotent `closeHostAndDrain` promise and a matching
`onClosed` observation. Timeout rejects the promise but retains the control
listener: a later valid receipt must still be forwarded to the operation chart
as `HOST_CLOSED`. The future worker root must retain this capability while any
operation retains custody. Disposing the channel is never proof of host closure.
A malformed, foreign-scope, wrong-correlation, or transferred-handle response is
rejected/ignored without reporting closure.

## Integration still required

These adapters are not connected to the running application. The worker root
must own both channels, bind `onClosed` to its scoped operation actor, and await
closure before retiring that operation. Closing this storage host does not drain
Jazz or close SDK-owned transferred broker ports; SDK shutdown is a separate
worker-root obligation. Legacy-key storage admission and the SDK AccountStore
facade remain separate implementation steps before live session handoff.

## Review and qualification

After implementation approval, all 24 native bridge tests pass on Node
24.22.2 (`pnpm test:worker-host`), including seven focused close-channel cases:
acknowledged storage remains committed, storage requests after the close receipt
cannot execute, control closure survives data-client failure, delayed receipts
remain observable after timeout without retry, malformed/foreign/uncorrelated
receipts are ignored, disposal is not a receipt, and failed Window closure is
never acknowledged. The standalone strict TypeScript check also passes.

These are native Node MessageChannel tests, not browser persistence qualification.
The next legacy-storage batch remains subject to separate implementation review
before updating/running affected bridge and account-store campaigns.
