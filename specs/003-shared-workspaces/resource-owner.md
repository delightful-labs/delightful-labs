# Shared workspace resource owner

This composition uses the existing DLF workspace selector. It adds resource
custody and receipt sequencing, not another selection or authorization policy.
The native application still owns the SDK/client attachment and global identity
controllers. Both apps supply their concrete domain resource actor.

## Producer contract

The factory receives concrete actor logic, a pure lease/binding-to-input
projection, its supported shutdown event, a pure public-view projection, a pure
failed-snapshot classification and a pure terminal-receipt classification
(`released` or `unresolved`, including missing output). Keep the full concrete
resource event/snapshot/input/output types through supported XState generics.

Return the owner logic and a typed public report selector. The owner input fixes
one `WorkspaceSelectionScope` and the app's native binding payload. Its external
protocol accepts existing selection intents/observations plus shutdown. A typed
`RESOURCE_COMMAND` envelope carries the exact lease and one concrete resource
event; it is direct state-owned forwarding to one actor, not a registry or bus.
Exclude the resource's shutdown event from external resource commands. The shared
owner enforces lease admission before forwarding; late caller state cannot bypass
that check. Domain policy remains in the resource actor. An optional queued
`refused` leaf lets the app release/reject owned command payloads after refusal,
including before selection and during drain/close/unresolved custody. It cannot
select admission or start another resource.

## Owned states and facts

- Waiting: the selector is live; no domain resource exists. Forward scoped intent.
- Holding/active: invoke one resource for the selector's lease and project its
  current public view. Forward only commands for that exact lease.
- Holding/invalidated: withdraw admission before requesting any resource shutdown.
- Holding/draining: retain the selector's exact drain token, send resource shutdown
  once and wait for its real terminal receipt. New selection/access facts go to
  the existing selector, which owns pending intent.
- Holding/closing: shutdown overrides pending replacement while retaining the same
  resource invocation and exact receipt obligation.
- Holding/completed: retain an unsolicited terminal receipt while obtaining the
  selector's exact drain token; never pretend a missing token is an acknowledgement.
- Holding/unresolved: publish failure, retain the original invocation/lease/receipt
  and forbid replacement or clean native close. A failed but active domain actor
  may still own issued work; stopping it is not settlement.
- Closing without a resource: wait for the selector's clean terminal output.
- Closed: terminal only after demonstrated resource release and selector closure.

Context holds admitted input, lease, drain token, public view, real completion
receipt and classified failure facts. It does not mirror active states in flags
or store whole child snapshots. Public reports carry the exact lease for active
views and retain failure/receipt correlation for unresolved ownership.

## Receipt ordering

Normal successful drain acknowledges only its matching selector token, releases
custody, then permits the selector's next activation. Unresolved output or an active
failed/crashed resource reports `DRAIN_FAILED` with unresolved ownership and retains
custody. Never await a terminal receipt from an irrecoverably failed actor.

Unexpected resource completion is a protocol failure even when its actual output
proves release. Once the exact token is available, acknowledge that evidence as
`DRAIN_FAILED/released`; the existing selector then requires explicit retry rather
than silently activating a pending target. Preserve shutdown priority in this case.
Never manufacture release from actor stop, a missing child or an empty directory.

Selector crash/unexpected closure likewise fails custody. Preserve a live resource
invocation in an unresolved holding state. Late snapshots/receipts cannot reopen
admission or start replacement. Successful terminal snapshots are consumed through
terminal receipt handling, not mistaken for failed active views.

## Qualification

Use the real selector with controlled concrete resource actors. Cover local access
without directory membership, denied/unknown evidence, same-lease observations,
reordered/foreign commands and A → B → A; held release while requests change;
shutdown before/during construction, invalidation and drain; repeated shutdown;
active failed state, actor crash, missing/unresolved output and unsolicited clean
completion. Check exact tokens, single acquisition/shutdown, absence of premature
replacement and retained unresolved custody. Include generated schedules with an
independent behavioral oracle and packed public-consumer type/execution coverage.
Production adoption must qualify actual Finance and Clipper resources separately.
