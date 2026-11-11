import { required } from '../bank-sync/identity.js'
import {
	archiveAllowed,
	archiveScopeMatches,
	createAccountArchiveOperation,
	type ArchiveObservation,
	type ArchiveRequest,
	type ArchiveResult
} from './account-archive-operation.js'
import { setup, types, matchesState } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type ArchiveRowAction = 'unavailable' | 'available' | 'disabled' | 'archiving'
export type AccountArchiveView = {
	kind: 'sessionUnavailable' | 'selectWorkspace' | 'loading' | 'loadFailed' | 'ready' | 'closed'
	rows: readonly { account: ArchiveObservation['accounts'][number]; action: ArchiveRowAction }[]
	feedback: ArchiveResult | undefined
}
type Context = {
	observation: ArchiveObservation
	request: ArchiveRequest | undefined
	result: ArchiveResult | undefined
}
type Event =
	| { type: 'OBSERVE'; observation: ArchiveObservation }
	| { type: 'ARCHIVE'; accountId: string }
	| { type: 'CANCEL' | 'SHUTDOWN' }
export function createAccountArchiveMachine(
	persist: (request: ArchiveRequest) => Promise<unknown>,
	observe: () => ArchiveObservation
) {
	const operation = createAccountArchiveOperation(persist, observe)
	const events0 = {
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
		ARCHIVE: types<EventPayload<Event, 'ARCHIVE'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof operation>>
		| import('xstate').ErrorActorEvent
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			children: {
				operation:
					types<import('xstate').ActorRefFrom<{ operation: typeof operation }['operation']>>()
			}
		},
		actors: { operation },
		guards: {
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ operating: 'closing' }, args.value)
		}
	})
	const readiness = workflow.createStateConfig({
		initial: 'assessing',
		states: {
			assessing: {
				always: (args: { context: Context }) => {
					const { context } = args
					if (
						!context.observation.sessionReady ||
						!context.observation.identityId ||
						!context.observation.binding
					) {
						return { target: 'sessionUnavailable' }
					}
					if (!context.observation.organizationId) {
						return { target: 'selectWorkspace' }
					}
					if (context.observation.failed) {
						return { target: 'loadFailed' }
					}
					if (context.observation.loading) {
						return { target: 'loading' }
					}
					return { target: 'ready' }
				}
			},
			sessionUnavailable: { tags: ['sessionUnavailable'] },
			selectWorkspace: { tags: ['selectWorkspace'] },
			loadFailed: { tags: ['loadFailed'] },
			loading: { tags: ['loading'] },
			ready: {}
		}
	})
	const active = workflow.createStateConfig({
		initial: 'running',
		invoke: {
			id: 'operation',
			src: 'operation',
			input: ({ context }: { context: Context }) => ({
				request: required(context.request),
				observation: context.observation
			}),
			onDone: (args) => {
				const { event } = args
				if (matchesState({ operating: 'closing' }, args.value)) {
					return { target: '#account-archive.closed' }
				}
				if (event.output.outcome === 'closed') {
					return { target: '#account-archive.closed' }
				}
				return {
					target: '#account-archive.assessing',
					context: { result: event.output, request: undefined, observation: observe() }
				}
			},
			onError: (args) => {
				if (matchesState({ operating: 'closing' }, args.value)) {
					return { target: '#account-archive.closed' }
				}
				return {
					target: '#account-archive.assessing',
					context: {
						result: {
							outcome: 'failed',
							request: required(args.context.request),
							settlement: 'unknown'
						},
						request: undefined,
						observation: observe()
					}
				}
			}
		},
		on: {
			OBSERVE: (args, enq) => {
				const { event } = args
				enq.sendTo('operation', event)
				return {
					target: '.running.assessing',
					context: ((args) => ({
						observation: (({ context, event }) =>
							event.type === 'OBSERVE' ? event.observation : context.observation)(args)
					}))(args)
				}
			},
			CANCEL: (args, enq) => {
				enq.sendTo('operation', { type: 'CANCEL' })
			},
			SHUTDOWN: (args, enq) => {
				enq.sendTo('operation', { type: 'SHUTDOWN' })
				return { target: '.closing' }
			}
		},
		states: { running: readiness, closing: { on: { SHUTDOWN: {}, CANCEL: {}, OBSERVE: {} } } }
	})
	return workflow.createMachine({
		id: 'account-archive',
		initial: 'assessing',
		context: () => ({ observation: observe(), request: undefined, result: undefined }),
		on: {
			OBSERVE: (args) => {
				return {
					target: '.assessing',
					context: ((args) => ({
						observation: (({ context, event }) =>
							event.type === 'OBSERVE' ? event.observation : context.observation)(args)
					}))(args)
				}
			},
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			...readiness.states,
			ready: {
				on: {
					ARCHIVE: (args) => {
						const { context, event } = args
						if (!archiveAllowed(context.observation, event.accountId)) return
						return {
							target: 'operating',
							context: {
								request:
									event.type === 'ARCHIVE'
										? {
												identityId: required(context.observation.identityId),
												organizationId: required(context.observation.organizationId),
												binding: required(context.observation.binding),
												accountId: event.accountId,
												name: required(
													context.observation.accounts.find(
														(account) => account.id === event.accountId
													)
												).name
											}
										: undefined,
								result: undefined
							}
						}
					}
				}
			},
			operating: active,
			closed: {
				type: 'final',
				entry: () => {
					return {
						context: {
							request: undefined,
							result: undefined,
							observation: {
								identityId: null,
								organizationId: null,
								binding: null,
								sessionReady: false,
								loading: false,
								failed: false,
								accounts: [],
								membership: undefined,
								grants: []
							}
						}
					}
				}
			}
		}
	})
}
export function selectAccountArchiveView(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountArchiveMachine>>
): AccountArchiveView {
	const observation = snapshot.context.observation
	const active = snapshot.matches('operating')
	const kind = snapshot.matches('closed')
		? 'closed'
		: snapshot.hasTag('sessionUnavailable')
			? 'sessionUnavailable'
			: snapshot.hasTag('selectWorkspace')
				? 'selectWorkspace'
				: snapshot.hasTag('loadFailed')
					? 'loadFailed'
					: snapshot.hasTag('loading') || snapshot.matches('assessing')
						? 'loading'
						: 'ready'
	return {
		kind,
		rows: observation.accounts
			.filter((account) => account.organizationId === observation.organizationId)
			.map((account) => ({
				account,
				action: !archiveAllowed(observation, account.id)
					? 'unavailable'
					: !active
						? 'available'
						: snapshot.context.request?.accountId === account.id
							? 'archiving'
							: 'disabled'
			})),
		feedback:
			snapshot.context.result && archiveScopeMatches(snapshot.context.result.request, observation)
				? snapshot.context.result
				: undefined
	}
}
