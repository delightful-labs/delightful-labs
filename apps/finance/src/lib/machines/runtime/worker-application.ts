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
	WorkerAccountRecord,
	WorkerWorkspace
} from '../../contracts/worker-application.js'
import {
	createAccountArchiveMachine,
	selectAccountArchiveReport
} from '../accounts/account-archive.js'
import type { ArchiveObservation, ArchiveRequest } from '../accounts/account-archive-operation.js'
import { projectAccountArchiveFeedback } from '../../contracts/account-archive-feedback.js'

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
	accounts: WorkerAccountRecord[] | null
	membership: ArchiveObservation['membership']
	grants: ArchiveObservation['grants'] | null
	archive: ReturnType<typeof selectAccountArchiveReport> | undefined
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
const membership = createCallbackLogic<
	never,
	ReadInput & { selection: WorkerSelection; binding: object }
>(({ input, sendBack }) => {
	if (!input.selection.workspaceId) return
	let active = true
	const release = input.ready.capabilities.observeMembership(
		input.selection.workspaceId,
		(row) => {
			if (active) sendBack({ type: 'MEMBERSHIP', binding: input.binding, row })
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
const grants = createCallbackLogic<
	never,
	ReadInput & { selection: WorkerSelection; binding: object }
>(({ input, sendBack }) => {
	if (!input.selection.workspaceId) return
	let active = true
	const release = input.ready.capabilities.observeGrants(
		input.selection.workspaceId,
		(rows) => {
			if (active) sendBack({ type: 'GRANTS', binding: input.binding, rows })
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

function archiveObservation(context: Context): ArchiveObservation {
	return {
		identityId: context.ready?.identityId ?? null,
		organizationId: context.selection.workspaceId,
		binding: context.readBinding ?? null,
		sessionReady: context.ready !== undefined,
		loading:
			context.accounts === null || context.membership === undefined || context.grants === null,
		failed: false,
		accounts: context.accounts ?? [],
		membership: context.membership,
		grants: context.grants ?? []
	}
}
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
export function createFinanceWorkerMachine({
	persist,
	observe
}: {
	persist: (request: ArchiveRequest) => Promise<unknown>
	observe: () => ArchiveObservation
}) {
	const archive = createAccountArchiveMachine(persist, observe)
	const withdrawn = { accounts: null, membership: undefined, grants: null, archive: undefined }
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			events: {
				SESSION: types<{ view: SessionRuntimeView<FinanceReadCapabilities> }>(),
				WORKSPACES: types<{ binding: object; rows: WorkerWorkspace[] }>(),
				ACCOUNTS: types<{ binding: object; rows: WorkerAccountRecord[] }>(),
				MEMBERSHIP: types<{ binding: object; row: ArchiveObservation['membership'] }>(),
				GRANTS: types<{ binding: object; rows: ArchiveObservation['grants'] }>(),
				READ_FAILED: types<{ binding: object }>(),
				ACCOUNTS_FAILED: types<{ binding: object }>(),
				SELECT_WORKSPACE: types<{ selection: WorkerSelection }>(),
				ARCHIVE_ACCOUNT: types<{ selection: WorkerSelection; accountId: string }>(),
				CLOSE: types(),
				NATIVE_FAILED: types(),
				READ_DISPOSAL_FAILED: types()
			},
			children: { archive: types<import('xstate').ActorRefFrom<typeof archive>>() }
		},
		actors: {
			observeSession,
			workspaces,
			accounts,
			membership,
			grants,
			archive,
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
			accounts: null,
			membership: undefined,
			grants: null,
			archive: undefined,
			readBinding: undefined,
			sessionStatus: 'starting'
		}),
		output: () => ({ outcome: 'closed' }),
		invoke: [
			{
				src: 'observeSession',
				input: ({ context }) => context.session,
				onError: {
					target: '.failed',
					context: { ready: undefined, workspaces: null, ...withdrawn }
				}
			},
			{
				id: 'archive',
				src: 'archive',
				onSnapshot: ({ context, event }) => {
					if (event.snapshot.status === 'stopped' || event.snapshot.status === 'error')
						return {
							target: '.drainFailed',
							context: { ...withdrawn, ready: undefined, workspaces: null }
						}
					const report = selectAccountArchiveReport(event.snapshot)
					return report.binding === context.readBinding
						? { context: { archive: report } }
						: undefined
				},
				onDone: ({ value }) =>
					value === 'cleanupFailed'
						? undefined
						: { target: value === 'draining' ? '.closingSession' : '.drainFailed' },
				onError: {
					target: '.drainFailed',
					context: { ready: undefined, accounts: null, workspaces: null }
				}
			}
		],
		on: {
			CLOSE: (_, enq) => {
				enq.sendTo('archive', { type: 'SHUTDOWN' })
				return {
					target: '.draining',
					context: { ready: undefined, workspaces: null, accounts: null }
				}
			},
			READ_DISPOSAL_FAILED: {
				target: '.cleanupFailed',
				context: { ready: undefined, workspaces: null, ...withdrawn }
			},
			NATIVE_FAILED: {
				target: '.failed',
				context: { ready: undefined, workspaces: null, ...withdrawn }
			}
		},
		states: {
			running: {
				initial: 'waiting',
				on: {
					SESSION: ({ context, event }, enq) => {
						const view = event.view,
							ready = view.observation
						if (
							view.stage === 'failed' ||
							view.stage === 'closed' ||
							view.stage === 'openFailed' ||
							view.stage === 'observerFailed'
						) {
							const next = {
								...context,
								ready: undefined,
								workspaces: null,
								...withdrawn,
								sessionStatus: view.status
							}
							enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
							return { target: '#finance-worker.failed', context: next }
						}
						if (ready?.status !== 'ready') {
							const next = {
								...context,
								ready: undefined,
								workspaces: null,
								...withdrawn,
								sessionStatus: view.status
							}
							enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
							return { target: '.waiting', context: next }
						}
						if (context.ready?.binding === ready.binding)
							return { context: { sessionStatus: view.status } }
						const next = {
							...context,
							ready,
							workspaces: null,
							...withdrawn,
							readBinding: {},
							sessionStatus: view.status
						}
						enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
						return { target: '.ready', reenter: true, context: next }
					},
					SELECT_WORKSPACE: ({ context, event }, enq) => {
						if (event.selection.revision <= context.selection.revision) return
						const next = { ...context, selection: event.selection, ...withdrawn, readBinding: {} }
						enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
						return { target: context.ready ? '.ready' : '.waiting', reenter: true, context: next }
					},
					ARCHIVE_ACCOUNT: ({ context, event }, enq) => {
						if (
							event.selection.revision !== context.selection.revision ||
							event.selection.workspaceId !== context.selection.workspaceId
						)
							return
						enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(context) })
						enq.sendTo('archive', { type: 'ARCHIVE', accountId: event.accountId })
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
								onError: { target: 'readFailed', context: { workspaces: null, ...withdrawn } }
							},
							{
								src: 'accounts',
								input: ({ context, self }) => ({
									reportDisposalFailure: () => self.send({ type: 'READ_DISPOSAL_FAILED' }),
									ready: required(context.ready),
									selection: context.selection,
									binding: required(context.readBinding)
								}),
								onError: { target: 'readFailed', context: { ...withdrawn } }
							},
							{
								src: 'membership',
								input: ({ context, self }) => ({
									ready: required(context.ready),
									selection: context.selection,
									binding: required(context.readBinding),
									reportDisposalFailure: () => self.send({ type: 'READ_DISPOSAL_FAILED' })
								}),
								onError: ({ context }, enq) => {
									const next = { ...context, ...withdrawn }
									enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
									return { target: 'readFailed', context: next }
								}
							},
							{
								src: 'grants',
								input: ({ context, self }) => ({
									ready: required(context.ready),
									selection: context.selection,
									binding: required(context.readBinding),
									reportDisposalFailure: () => self.send({ type: 'READ_DISPOSAL_FAILED' })
								}),
								onError: ({ context }, enq) => {
									const next = { ...context, ...withdrawn }
									enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
									return { target: 'readFailed', context: next }
								}
							}
						],
						on: {
							WORKSPACES: ({ context, event }) =>
								event.binding === context.ready?.binding
									? { context: { workspaces: event.rows } }
									: undefined,
							ACCOUNTS: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, accounts: event.rows }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								return { target: '.loaded', context: { accounts: event.rows } }
							},
							MEMBERSHIP: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, membership: event.row }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								return { context: { membership: event.row } }
							},
							GRANTS: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, grants: event.rows }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								return { context: { grants: event.rows } }
							},
							READ_FAILED: ({ context, event }, enq) => {
								if (event.binding !== context.ready?.binding) return
								const next = { ...context, ...withdrawn, workspaces: null }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								return { target: 'readFailed', context: next }
							},
							ACCOUNTS_FAILED: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, ...withdrawn }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								return { target: 'readFailed', context: next }
							}
						},
						states: { loading: {}, loaded: {} }
					},
					readFailed: {}
				}
			},
			draining: { on: { CLOSE: {}, NATIVE_FAILED: {} } },
			drainFailed: { on: { CLOSE: {} } },
			closeFailed: { on: { CLOSE: { target: 'closingSession' } } },
			closingSession: {
				on: { CLOSE: {}, NATIVE_FAILED: { target: 'closeFailed' } },
				invoke: {
					src: 'closeSession',
					input: ({ context }) => context.session,
					onDone: ({ event }) => ({
						target: event.output.outcome === 'closed' ? 'closingAccountStore' : 'closeFailed'
					}),
					onError: { target: 'closeFailed' }
				}
			},
			closingAccountStore: {
				on: { CLOSE: {}, NATIVE_FAILED: { target: 'closeFailed' } },
				invoke: {
					src: 'closeStore',
					input: ({ context }) => context.closeAccountStore,
					onDone: { target: 'closingBroker' },
					onError: { target: 'closeFailed' }
				}
			},
			closingBroker: {
				on: { CLOSE: {}, NATIVE_FAILED: { target: 'closeFailed' } },
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
									: 'closeFailed'
						}
					},
					onError: { target: 'closeFailed' }
				}
			},
			cleanupFailed: { on: { CLOSE: {}, NATIVE_FAILED: {} } },
			failed: {},
			closed: { type: 'final' }
		}
	})
}
export function selectFinanceWorkerView(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>>
): FinanceWorkerView {
	const { context } = snapshot
	const status = snapshot.matches('closed')
		? 'closed'
		: snapshot.status !== 'active' ||
			  snapshot.matches('failed') ||
			  snapshot.matches('cleanupFailed') ||
			  snapshot.matches('drainFailed') ||
			  snapshot.matches('closeFailed') ||
			  snapshot.matches({ running: 'readFailed' })
			? 'failed'
			: snapshot.matches('draining') ||
				  snapshot.matches('closingSession') ||
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
		accounts:
			snapshot.status === 'active'
				? (context.accounts ?? []).map(({ id, name, kind, currency }) => ({
						id,
						name,
						kind,
						currency,
						archiveAction:
							context.archive && context.archive.binding === context.readBinding
								? (context.archive.view.rows.find((row) => row.account.id === id)?.action ??
									'unavailable')
								: 'unavailable'
					}))
				: [],
		archiveFeedback:
			snapshot.status === 'active' &&
			context.archive &&
			context.archive.binding === context.readBinding
				? projectAccountArchiveFeedback(context.archive.view.feedback)
				: null
	}
}

export function selectFinanceArchiveObservation(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined
): ArchiveObservation {
	if (snapshot?.status === 'active') return archiveObservation(snapshot.context)
	return {
		identityId: null,
		organizationId: null,
		binding: null,
		sessionReady: false,
		loading: true,
		failed: false,
		accounts: [],
		membership: undefined,
		grants: []
	}
}

/** Capture the already-admitted leaf again at issue time; native binding checks remain beside SDK I/O. */
export function selectFinanceArchiveWriter(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined,
	request: ArchiveRequest
) {
	const context = snapshot?.context
	return snapshot?.status === 'active' &&
		context?.ready &&
		context.readBinding === request.binding &&
		context.ready.identityId === request.identityId &&
		context.selection.workspaceId === request.organizationId
		? context.ready.capabilities.archiveAccount
		: undefined
}
