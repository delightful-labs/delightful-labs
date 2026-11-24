import {
	createCallbackLogic,
	setup,
	types,
	type ActorRefFrom,
	type EventFromLogic,
	type InputFrom,
	type SendableEventFromLogic,
	type SnapshotFrom
} from 'xstate'
import { createWorkspaceResourceOwner } from 'delightful-local-first/workspace/resource'
import { createBoundObservationLogic } from 'delightful-local-first/data/observation-workflow'
import type { ObservationReleaseOutcome } from 'delightful-local-first/data/observation-workflow'
import type {
	WorkspaceLease,
	WorkspaceSelectionScope
} from 'delightful-local-first/workspace/contracts'
import type { ReadyAccountObservation, WorkspaceAccess } from '../../contracts/account.js'
import type { LibraryEvent } from '../../contracts/library.js'
import { libraryMachine } from '../capture/library.js'

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Workspace library unavailable')
	return value
}
type Binding = {
	account: ReadyAccountObservation
	reportDisposalFailure: (error: unknown) => void
}
type LibraryInput = NonNullable<InputFrom<typeof libraryMachine>>
type ResourceInput = Binding & { lease: WorkspaceLease }
type ResourceContext = { input: ResourceInput; capability: LibraryInput | undefined }
type LibraryRef = ActorRefFrom<typeof libraryMachine>
export function refuseLibraryCommand(event: LibraryEvent) {
	if (event.type === 'READER_EVENT' && event.event.type === 'ATTACH_SURFACE')
		event.event.surface.lifecycle?.released()
}

// Native capability construction only. Its guard lives through the domain drain,
// then withdraws when this resource really completes or is forcibly stopped.
const acquire = createCallbackLogic<never, Binding>(({ input, sendBack }) => {
	let live = true
	const capability = input.account.capabilities.createLibrary(() => live)
	sendBack({ type: 'ACQUIRED', capability })
	return () => {
		live = false
	}
})
const resource = setup({
	schemas: {
		input: types<ResourceInput>(),
		context: types<ResourceContext>(),
		output: types<{ outcome: 'released' | 'unresolved' }>(),
		events: {
			ACQUIRED: types<{ capability: LibraryInput }>(),
			COMMAND: types<{ event: Exclude<LibraryEvent, { type: 'SHUTDOWN' }> }>(),
			SHUTDOWN: types()
		},
		children: {
			acquire: types<ActorRefFrom<typeof acquire>>(),
			library: types<LibraryRef>()
		}
	},
	actors: { acquire, library: libraryMachine }
}).createMachine({
	id: 'clipper-workspace-library',
	initial: 'acquiring',
	context: ({ input }) => ({ input, capability: undefined }),
	invoke: {
		id: 'acquire',
		src: 'acquire',
		input: ({ context }) => context.input,
		onError: { target: '.unresolved' }
	},
	on: { COMMAND: ({ event }, enq) => enq(refuseLibraryCommand, event.event) },
	states: {
		acquiring: {
			on: {
				ACQUIRED: ({ event }) => ({
					target: 'owning.active',
					context: { capability: event.capability }
				}),
				SHUTDOWN: { target: 'stoppingAcquisition' }
			}
		},
		stoppingAcquisition: {
			on: {
				ACQUIRED: ({ event }) => ({
					target: 'owning.closing',
					context: { capability: event.capability }
				})
			}
		},
		owning: {
			initial: 'active',
			invoke: {
				id: 'library',
				src: 'library',
				input: ({ context }) => ({
					...required(context.capability),
					reportDisposalFailure: context.input.reportDisposalFailure
				}),
				onDone: ({ event }) => ({
					target: event.output.outcome === 'released' ? 'released' : 'unresolved'
				}),
				onError: { target: 'unresolved' }
			},
			states: {
				active: {
					on: {
						COMMAND: ({ event }, enq) => enq.sendTo('library', event.event),
						SHUTDOWN: { target: 'closing' }
					}
				},
				closing: { entry: (_args, enq) => enq.sendTo('library', { type: 'SHUTDOWN' }) }
			}
		},
		released: { type: 'final', output: { outcome: 'released' } },
		unresolved: { type: 'final', output: { outcome: 'unresolved' } }
	}
})

const workspace = createWorkspaceResourceOwner<
	Binding,
	InputFrom<typeof resource>,
	EventFromLogic<typeof resource>,
	SnapshotFrom<typeof resource>,
	LibraryRef | undefined,
	SendableEventFromLogic<typeof resource>
>({
	resource,
	input: (lease, binding) => ({ ...binding, lease }),
	shutdown: { type: 'SHUTDOWN' },
	view: (snapshot) =>
		snapshot.matches({ owning: 'active' }) ? snapshot.children.library : undefined,
	failed: (snapshot) => snapshot.status === 'error',
	settlement: (output) => (output?.outcome === 'released' ? 'released' : 'unresolved'),
	refused: (command) => {
		if (command.type === 'COMMAND') refuseLibraryCommand(command.event)
	}
})

type AccessInput = {
	scope: WorkspaceSelectionScope
	access: WorkspaceAccess
	reportDisposalFailure: Binding['reportDisposalFailure']
}
const access = createBoundObservationLogic<
	'allowed' | 'unknown' | 'denied',
	AccessInput,
	| { type: 'ACCESS'; input: AccessInput; access: 'allowed' | 'unknown' | 'denied' | 'failed' }
	| { type: 'ACCESS_RELEASED'; input: AccessInput; outcome: ObservationReleaseOutcome }
>({
	observe: (input, publish, failed) => input.access.subscribe(publish, failed),
	observed: (input, access) => ({ type: 'ACCESS', input, access }),
	failed: (input) => ({ type: 'ACCESS', input, access: 'failed' }),
	disposalFailed: (input, error) => input.reportDisposalFailure(error),
	released: (input, outcome) => ({ type: 'ACCESS_RELEASED', input, outcome })
})
type Input = Binding & { scope: WorkspaceSelectionScope }
type Report = ReturnType<typeof workspace.selectReport>
type Context = {
	input: Input
	accessInput: AccessInput
	generation: number
	report: Report | undefined
	workspaceClosed: boolean
	accessReceipt: ObservationReleaseOutcome | undefined
}
/** Identity/access outlive selected content; the shared owner alone grants its lease. */
export const workspaceLibraryMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		output: types<{ outcome: 'released' }>(),
		events: {
			SHUTDOWN: types(),
			ACCESS: types<{ input: AccessInput; access: 'allowed' | 'unknown' | 'denied' | 'failed' }>(),
			ACCESS_RELEASED: types<{ input: AccessInput; outcome: ObservationReleaseOutcome }>(),
			COMMAND: types<{
				lease: WorkspaceLease
				event: Exclude<LibraryEvent, { type: 'SHUTDOWN' }>
			}>()
		},
		children: {
			workspace: types<ActorRefFrom<typeof workspace.logic>>(),
			access: types<ActorRefFrom<typeof access>>()
		}
	},
	actors: { workspace: workspace.logic, access }
}).createMachine({
	id: 'clipper-workspace-owner',
	initial: 'active',
	context: ({ input }) => ({
		input,
		accessInput: {
			scope: input.scope,
			access: input.account.capabilities.access,
			reportDisposalFailure: input.reportDisposalFailure
		},
		generation: 0,
		report: undefined,
		workspaceClosed: false,
		accessReceipt: undefined
	}),
	entry: ({ context }, enq) =>
		enq.sendTo('workspace', {
			type: 'SELECT',
			scope: context.input.scope,
			request: { workspaceId: context.accessInput.access.workspaceId, attempt: 1 }
		}),
	invoke: [
		{
			id: 'workspace',
			src: 'workspace',
			input: ({ context }) => ({ scope: context.input.scope, binding: context.input }),
			onSnapshot: ({ event }) => ({ context: { report: workspace.selectReport(event.snapshot) } }),
			onDone: () => ({ context: { workspaceClosed: true } }),
			onError: { target: '.unresolved' }
		},
		{
			id: 'access',
			src: 'access',
			input: ({ context }) => context.accessInput,
			onError: { target: '.unresolved' }
		}
	],
	on: {
		COMMAND: ({ context, event, value }, enq) => {
			if (value !== 'active' || context.workspaceClosed) {
				enq(refuseLibraryCommand, event.event)
				return
			}
			enq.sendTo('workspace', {
				type: 'RESOURCE_COMMAND',
				lease: event.lease,
				command: { type: 'COMMAND', event: event.event }
			})
		},
		ACCESS_RELEASED: ({ context, event, value }) => {
			if (value === 'active' || event.input !== context.accessInput) return
			return { context: { accessReceipt: event.outcome } }
		}
	},
	states: {
		active: {
			always: ({ context }) =>
				context.report?.status === 'unresolved' ? { target: 'unresolved' } : undefined,
			on: {
				ACCESS: ({ context, event }, enq) => {
					if (event.input !== context.accessInput) return
					if (context.generation >= Number.MAX_SAFE_INTEGER) return { target: 'unresolved' }
					const generation = context.generation + 1
					enq.sendTo('workspace', {
						type: 'OBSERVED',
						observation: {
							scope: context.input.scope,
							request: { workspaceId: context.accessInput.access.workspaceId, attempt: 1 },
							generation,
							directory: { status: 'loading' },
							access: event.access
						}
					})
					return { context: { generation } }
				},
				SHUTDOWN: { target: 'closing' }
			}
		},
		closing: {
			entry: (_args, enq) => {
				enq.sendTo('workspace', { type: 'SHUTDOWN' })
				enq.sendTo('access', { type: 'RELEASE' })
			},
			always: ({ context }) => {
				if (context.report?.status === 'unresolved' || context.accessReceipt === 'unresolved')
					return { target: 'unresolved' }
				if (context.workspaceClosed && context.accessReceipt === 'released')
					return { target: 'closed' }
			}
		},
		unresolved: {
			entry: (_args, enq) => {
				enq.sendTo('workspace', { type: 'SHUTDOWN' })
				enq.sendTo('access', { type: 'RELEASE' })
			}
		},
		closed: { type: 'final', output: { outcome: 'released' } }
	}
})
export function selectWorkspaceLibrary(snapshot: SnapshotFrom<typeof workspaceLibraryMachine>) {
	const report = snapshot.context.report
	return {
		failed: snapshot.matches('unresolved') || report?.status === 'unresolved',
		lease: snapshot.matches('active') && report?.status === 'active' ? report.lease : undefined,
		library: snapshot.matches('active') && report?.status === 'active' ? report.view : undefined
	}
}

export type WorkspaceLibraryBinding = Readonly<{
	owner: ActorRefFrom<typeof workspaceLibraryMachine>
	lease: WorkspaceLease
}>
/** A native send capability captures its originating lease; it never upgrades an old intent. */
export function workspaceLibraryCommands(binding: WorkspaceLibraryBinding) {
	return {
		send: (event: LibraryEvent) => {
			if (event.type === 'SHUTDOWN') return
			if (binding.owner.getSnapshot().status !== 'active') {
				refuseLibraryCommand(event)
				return
			}
			binding.owner.send({ type: 'COMMAND', lease: binding.lease, event })
		}
	}
}
