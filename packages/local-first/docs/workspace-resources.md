# Own selected workspace resources

Use `createWorkspaceResourceOwner` from
`delightful-local-first/workspace/resource` around one app-owned resource actor.
Contracts are exported from `workspace/resource-contracts`; existing selection
contracts remain in `workspace/contracts`.

The factory invokes the existing workspace selector. Supply concrete resource
logic, a pure input projection, its shutdown event, a pure public-view projection,
a pure failed-snapshot classification and a terminal receipt classification.
The app keeps its schemas, authorization, storage and domain operation drains.
The resource must honor shutdown across its own acquisition and issued operations.

Use the actor's complete event, input, output and snapshot types. With the pinned
XState beta, explicit producer generics preserve the concrete contracts:

```ts
const owner = createWorkspaceResourceOwner<
	Binding,
	InputFrom<typeof resource>,
	EventFromLogic<typeof resource>,
	SnapshotFrom<typeof resource>,
	ResourceView
>({
	resource,
	input: (lease, binding) => ({ lease, binding }),
	shutdown: { type: 'SHUTDOWN' },
	view: projectResourceView,
	failed: resourceFailed,
	settlement: classifyTerminalReceipt
})
```

The complete checked/executed example is
[`fixtures/package-consumer/workspace-resource.ts`](../fixtures/package-consumer/workspace-resource.ts).
Its resource input/view belong to that consumer; adapt those projections to the
concrete app rather than introducing universal domain schemas.

Create the owner with `{ scope, binding }`. The scope fixes one native client
binding and attachment. Rebinding requires a fresh owner after demonstrated
release. Keep identity/profile/directory/access observers outside this owner.
Forward the existing scoped `SELECT`, `OBSERVED`, `SUSPEND`, `RESUME` and `RETRY`
protocol. Directory absence does not deny target access; the app supplies native
target-specific evidence. Same-workspace route updates retain the selection
request and lease.

Consume `owner.selectReport(snapshot)` at the public observation boundary. Only
an `active` report carries an admitted lease and resource view. Send a concrete
resource command through `{ type: 'RESOURCE_COMMAND', lease, command }`; the
owner rejects retired scope, attempt, workspace or epoch before delivery.
Resource shutdown and `DRAINED` are excluded from the caller command protocol.
If commands carry owned payloads, supply `refused(command, binding)` to release
or reject those payloads when admission fails. This queued native leaf keeps the
app's resource-specific cleanup outside the shared lifecycle. It also runs while
waiting, draining, closing or retaining unresolved custody.

On target/access invalidation, admission disappears before resource shutdown.
Pending selection facts remain with the existing selector while the original
resource drains. Only the actual terminal receipt acknowledges that exact drain
token and permits replacement. Root shutdown overrides pending replacement.

An `unresolved` report is failure evidence, not a clean close. It retains the
original scope/lease, drain and receipt when available. Active failed resources
remain invoked because they may still own issued work. Do not wait for a dead
resource, stop the owner to invent settlement, release the native SDK or create a
replacement. A normal owner completes with `{ outcome: 'closed' }` only after
resource release and selector closure. Unexpected but demonstrably released
resource completion requires explicit retry through the selector.

The shared factory is qualified independently. Each production integration still
needs native offline/restart, permission-change, pending-write and teardown proof.
