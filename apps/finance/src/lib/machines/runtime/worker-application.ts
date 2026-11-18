import { createAsyncLogic, createCallbackLogic, setup, types, type SnapshotFrom } from 'xstate'
import {
	sessionCloseMachine,
	type SessionRuntimeObservation,
	type SessionRuntimeView
} from 'delightful-local-first/session/runtime'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type {
	FinanceReadCapabilities,
	FinanceWorkerSession,
	FinanceWorkerView,
	WorkerSelection,
	WorkerAccount,
	WorkerWorkspace
} from '../../contracts/worker-application.js'

type Ready = Extract<SessionRuntimeObservation<FinanceReadCapabilities>, { status: 'ready' }>
type Input = {
	session: FinanceWorkerSession
	closeAccountStore: () => Promise<void>
	closeBroker: () => Promise<WorkerHostClosed>
	brokerIdentity: WorkerHostClosed
}
type Context = Input & {
	ready: Ready | undefined
	selection: WorkerSelection
	workspaces: WorkerWorkspace[] | null
	accounts: WorkerAccount[]
	readBinding: object | undefined
	sessionStatus: SessionRuntimeView['status']
}
const observeSession = createCallbackLogic<never, FinanceWorkerSession>(({ input, sendBack }) => {
	let active = true
	const publish = (view: SessionRuntimeView<FinanceReadCapabilities>) => {
		if (active) sendBack({ type: 'SESSION', view })
	}
	const read = () => {
		try {
			publish(input.view.get())
		} catch {
			sendBack({ type: 'NATIVE_FAILED' })
		}
	}
	const sub = input.view.subscribe({
		next: publish,
		error: () => sendBack({ type: 'NATIVE_FAILED' }),
		complete: read
	})
	read()
	return () => {
		active = false
		sub.unsubscribe()
	}
})
type ReadInput = { ready: Ready; reportDisposalFailure: () => void }
const workspaces = createCallbackLogic<never, ReadInput>(({ input, sendBack }) => {
	let active = true
	const release = input.ready.capabilities.observeWorkspaces(
		(rows) => {
			if (active) sendBack({ type: 'WORKSPACES', binding: input.ready.binding, rows })
		},
		() => {
			if (active) sendBack({ type: 'READ_FAILED', binding: input.ready.binding })
		}
	)
	return () => {
		active = false
		try {
			release()
		} catch {
			input.reportDisposalFailure()
		}
	}
})
const accounts = createCallbackLogic<
	never,
	ReadInput & { selection: WorkerSelection; binding: object }
>(({ input, sendBack }) => {
	if (!input.selection.workspaceId) return
	let active = true
	const release = input.ready.capabilities.observeAccounts(
		input.selection.workspaceId,
		(rows) => {
			if (active) sendBack({ type: 'ACCOUNTS', binding: input.binding, rows })
		},
		() => {
			if (active) sendBack({ type: 'ACCOUNTS_FAILED', binding: input.binding })
		}
	)
	return () => {
		active = false
		try {
			release()
		} catch {
			input.reportDisposalFailure()
		}
	}
})
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Finance worker resource unavailable')
	return value
}
const closeStore = createAsyncLogic({
	run: ({ input }: { input: Input['closeAccountStore'] }) => input()
})
const closeBroker = createAsyncLogic({
	run: ({ input }: { input: Input['closeBroker'] }) => input()
})
export const financeWorkerMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		output: types<{ outcome: 'closed' }>(),
		events: {
			SESSION: types<{ view: SessionRuntimeView<FinanceReadCapabilities> }>(),
			WORKSPACES: types<{ binding: object; rows: WorkerWorkspace[] }>(),
			ACCOUNTS: types<{ binding: object; rows: WorkerAccount[] }>(),
			READ_FAILED: types<{ binding: object }>(),
			ACCOUNTS_FAILED: types<{ binding: object }>(),
			SELECT_WORKSPACE: types<{ selection: WorkerSelection }>(),
			CLOSE: types(),
			NATIVE_FAILED: types(),
			READ_DISPOSAL_FAILED: types()
		}
	},
	actors: {
		observeSession,
		workspaces,
		accounts,
		closeSession: sessionCloseMachine,
		closeStore,
		closeBroker
	}
}).createMachine({
	id: 'finance-worker',
	initial: 'running',
	context: ({ input }) => ({
		...input,
		ready: undefined,
		selection: { workspaceId: null, revision: 0 },
		workspaces: null,
		accounts: [],
		readBinding: undefined,
		sessionStatus: 'starting'
	}),
	output: () => ({ outcome: 'closed' }),
	invoke: {
		src: 'observeSession',
		input: ({ context }) => context.session,
		onError: { target: '.failed', context: { ready: undefined, workspaces: null, accounts: [] } }
	},
	on: {
		CLOSE: {
			target: '.closingSession',
			context: { ready: undefined, workspaces: null, accounts: [] }
		},
		READ_DISPOSAL_FAILED: {
			target: '.cleanupFailed',
			context: { ready: undefined, workspaces: null, accounts: [] }
		},
		NATIVE_FAILED: {
			target: '.failed',
			context: { ready: undefined, workspaces: null, accounts: [] }
		}
	},
	states: {
		running: {
			initial: 'waiting',
			on: {
				SESSION: ({ context, event }) => {
					if (
						event.view.stage === 'failed' ||
						event.view.stage === 'closed' ||
						event.view.stage === 'openFailed' ||
						event.view.stage === 'observerFailed'
					)
						return {
							target: '#finance-worker.failed',
							context: {
								ready: undefined,
								workspaces: null,
								accounts: [],
								sessionStatus: event.view.status
							}
						}
					const ready = event.view.observation
					if (ready?.status !== 'ready')
						return {
							target: '.waiting',
							context: {
								ready: undefined,
								workspaces: null,
								accounts: [],
								sessionStatus: event.view.status
							}
						}
					if (context.ready?.binding === ready.binding)
						return { context: { sessionStatus: event.view.status } }
					return {
						target: '.ready',
						reenter: true,
						context: {
							ready,
							workspaces: null,
							accounts: [],
							readBinding: {},
							sessionStatus: event.view.status
						}
					}
				},
				SELECT_WORKSPACE: ({ context, event }) => {
					if (event.selection.revision <= context.selection.revision) return
					return {
						target: context.ready ? '.ready' : '.waiting',
						reenter: true,
						context: { selection: event.selection, accounts: [], readBinding: {} }
					}
				}
			},
			states: {
				waiting: {},
				ready: {
					initial: 'loading',
					invoke: [
						{
							src: 'workspaces',
							input: ({ context, self }) => ({
								ready: required(context.ready),
								reportDisposalFailure: () => self.send({ type: 'READ_DISPOSAL_FAILED' })
							}),
							onError: { target: 'readFailed', context: { workspaces: null, accounts: [] } }
						},
						{
							src: 'accounts',
							input: ({ context, self }) => ({
								reportDisposalFailure: () => self.send({ type: 'READ_DISPOSAL_FAILED' }),
								ready: required(context.ready),
								selection: context.selection,
								binding: required(context.readBinding)
							}),
							onError: { target: 'readFailed', context: { accounts: [] } }
						}
					],
					on: {
						WORKSPACES: ({ context, event }) =>
							event.binding === context.ready?.binding
								? { context: { workspaces: event.rows } }
								: undefined,
						ACCOUNTS: ({ context, event }) =>
							event.binding === context.readBinding
								? { target: '.loaded', context: { accounts: event.rows } }
								: undefined,
						READ_FAILED: ({ context, event }) =>
							event.binding === context.ready?.binding
								? { target: 'readFailed', context: { workspaces: null, accounts: [] } }
								: undefined,
						ACCOUNTS_FAILED: ({ context, event }) =>
							event.binding === context.readBinding
								? { target: 'readFailed', context: { accounts: [] } }
								: undefined
					},
					states: { loading: {}, loaded: {} }
				},
				readFailed: {}
			}
		},
		closingSession: {
			on: { CLOSE: {} },
			invoke: {
				src: 'closeSession',
				input: ({ context }) => context.session,
				onDone: ({ event }) => ({
					target: event.output.outcome === 'closed' ? 'closingAccountStore' : 'failed'
				}),
				onError: { target: 'failed' }
			}
		},
		closingAccountStore: {
			on: { CLOSE: {} },
			invoke: {
				src: 'closeStore',
				input: ({ context }) => context.closeAccountStore,
				onDone: { target: 'closingBroker' },
				onError: { target: 'failed' }
			}
		},
		closingBroker: {
			on: { CLOSE: {} },
			invoke: {
				src: 'closeBroker',
				input: ({ context }) => context.closeBroker,
				onDone: ({ context, event }) => {
					const receipt = event.output
					return {
						target:
							receipt.scope === context.brokerIdentity.scope &&
							receipt.requestId === context.brokerIdentity.requestId
								? 'closed'
								: 'failed'
					}
				},
				onError: { target: 'failed' }
			}
		},
		cleanupFailed: { on: { CLOSE: {}, NATIVE_FAILED: {} } },
		failed: {},
		closed: { type: 'final' }
	}
})
export function selectFinanceWorkerView(
	snapshot: SnapshotFrom<typeof financeWorkerMachine>
): FinanceWorkerView {
	const { context } = snapshot
	const status = snapshot.matches('closed')
		? 'closed'
		: snapshot.status !== 'active' ||
			  snapshot.matches('failed') ||
			  snapshot.matches('cleanupFailed') ||
			  snapshot.matches({ running: 'readFailed' })
			? 'failed'
			: snapshot.matches('closingSession') ||
				  snapshot.matches('closingAccountStore') ||
				  snapshot.matches('closingBroker')
				? 'closing'
				: context.ready
					? context.workspaces === null
						? 'loading'
						: context.selection.workspaceId && snapshot.matches({ running: { ready: 'loading' } })
							? 'loading'
							: 'ready'
					: context.sessionStatus === 'signed-out'
						? 'signed-out'
						: 'starting'
	return {
		type: 'VIEW',
		selection: context.selection,
		status,
		identityId: snapshot.status === 'active' ? (context.ready?.identityId ?? null) : null,
		workspaces: snapshot.status === 'active' ? context.workspaces : null,
		accounts: snapshot.status === 'active' ? context.accounts : []
	}
}
