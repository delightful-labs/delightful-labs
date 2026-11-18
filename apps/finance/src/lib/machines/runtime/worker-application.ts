import {
	createAsyncLogic,
	createCallbackLogic,
	setup,
	types,
	matchesState,
	type SnapshotFrom,
	type ActorRefFrom,
	type ActorRef,
	type Snapshot
} from 'xstate'
import {
	sessionCloseMachine,
	type SessionRuntimeObservation,
	type SessionRuntimeView
} from 'delightful-local-first/session/runtime'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type {
	FinanceWorkerCapabilities,
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
import { createFinanceFormsMachine, selectFinanceFormsView } from './worker-forms.js'
import type { AccountCreationObservation } from '../../contracts/account-creation-contract.js'
import type { WorkerAccountCreationCommand } from '../../contracts/worker-forms.js'

type Ready = Extract<SessionRuntimeObservation<FinanceWorkerCapabilities>, { status: 'ready' }>
type FormsReport =
	| { type: 'FORMS_VIEW'; binding: object; view: ReturnType<typeof selectFinanceFormsView> }
	| { type: 'FORMS_CLOSED'; binding: object }
	| { type: 'FORMS_FAILED'; binding: object }
type Input = {
	session: FinanceWorkerSession
	closeAccountStore: () => Promise<void>
	closeBroker: () => Promise<WorkerHostClosed>
	brokerIdentity: WorkerHostClosed
}
type Context = Input & {
	ready: Ready | undefined
	selection: WorkerSelection
	sessionRevision: number
	workspaces: WorkerWorkspace[] | null
	accounts: WorkerAccountRecord[] | null
	membership: ArchiveObservation['membership']
	grants: ArchiveObservation['grants'] | null
	archive: ReturnType<typeof selectAccountArchiveReport> | undefined
	forms:
		| {
				binding: object
				owner: ActorRefFrom<ReturnType<typeof createFinanceFormsMachine>>
				observer: ActorRef<Snapshot<unknown>, never>
		  }
		| undefined
	formsView: ReturnType<typeof selectFinanceFormsView> | undefined
	readBinding: object | undefined
	sessionStatus: SessionRuntimeView['status']
}
const observeSession = createCallbackLogic<never, FinanceWorkerSession>(({ input, sendBack }) => {
	let active = true
	const publish = (view: SessionRuntimeView<FinanceWorkerCapabilities>) => {
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
function creationObservation(context: Context): AccountCreationObservation {
	const observation = archiveObservation(context)
	return {
		...observation,
		binding: context.ready?.binding ?? null,
		loading:
			context.accounts === null || context.membership === undefined || context.workspaces === null,
		error: null
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
	observe,
	observeCreation
}: {
	persist: (request: ArchiveRequest) => Promise<unknown>
	observe: () => ArchiveObservation
	observeCreation: () => AccountCreationObservation
}) {
	const archive = createAccountArchiveMachine(persist, observe)
	const withdrawn = { accounts: null, membership: undefined, grants: null, archive: undefined }
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			internalEvents: { ARCHIVE_DRAINED: types() },
			events: {
				SESSION: types<{ view: SessionRuntimeView<FinanceWorkerCapabilities> }>(),
				WORKSPACES: types<{ binding: object; rows: WorkerWorkspace[] }>(),
				ACCOUNTS: types<{ binding: object; rows: WorkerAccountRecord[] }>(),
				MEMBERSHIP: types<{ binding: object; row: ArchiveObservation['membership'] }>(),
				GRANTS: types<{ binding: object; rows: ArchiveObservation['grants'] }>(),
				READ_FAILED: types<{ binding: object }>(),
				ACCOUNTS_FAILED: types<{ binding: object }>(),
				SELECT_WORKSPACE: types<{ selection: WorkerSelection }>(),
				ARCHIVE_ACCOUNT: types<{
					selection: WorkerSelection
					sessionRevision: number
					accountId: string
				}>(),
				ACCOUNT_CREATION: types<{
					selection: WorkerSelection
					sessionRevision: number
					command: WorkerAccountCreationCommand
				}>(),
				FORMS_VIEW: types<{ binding: object; view: ReturnType<typeof selectFinanceFormsView> }>(),
				FORMS_CLOSED: types<{ binding: object }>(),
				FORMS_FAILED: types<{ binding: object }>(),
				CLOSE: types(),
				NATIVE_FAILED: types(),
				READ_DISPOSAL_FAILED: types()
			},
			children: {
				archive: types<import('xstate').ActorRefFrom<typeof archive>>(),
				forms: types<ActorRefFrom<ReturnType<typeof createFinanceFormsMachine>>>()
			}
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
			sessionRevision: 0,
			workspaces: null,
			accounts: null,
			membership: undefined,
			grants: null,
			archive: undefined,
			forms: undefined,
			formsView: undefined,
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
				onDone: ({ value }, enq) => {
					if (value === 'cleanupFailed') return
					if (matchesState('draining', value)) {
						enq.raise({ type: 'ARCHIVE_DRAINED' })
						return
					}
					return { target: '.drainFailed' }
				},
				onError: {
					target: '.drainFailed',
					context: { ready: undefined, accounts: null, workspaces: null }
				}
			}
		],
		on: {
			CLOSE: ({ context }, enq) => {
				enq.sendTo('archive', { type: 'SHUTDOWN' })
				if (context.forms) enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
				return {
					target: '.draining',
					context: { ready: undefined, workspaces: null, accounts: null }
				}
			},
			FORMS_VIEW: ({ context, event }) =>
				event.binding === context.forms?.binding &&
				event.view.selectionRevision === context.selection.revision
					? event.view.status === 'failed'
						? {
								target: '.drainFailed',
								context: { formsView: undefined, ready: undefined, ...withdrawn, workspaces: null }
							}
						: { context: { formsView: event.view } }
					: undefined,
			FORMS_FAILED: ({ context, event }) =>
				event.binding === context.forms?.binding
					? {
							target: '.drainFailed',
							context: { formsView: undefined, ready: undefined, ...withdrawn, workspaces: null }
						}
					: undefined,
			FORMS_CLOSED: ({ context, event, value }, enq) => {
				if (event.binding !== context.forms?.binding || !context.forms) return
				enq.stop(context.forms.observer)
				if (value === 'retiringForms')
					return {
						target:
							context.sessionStatus === 'error' || context.sessionStatus === 'closed'
								? '.failed'
								: context.ready
									? '.running.ready'
									: '.running.waiting',
						context: { forms: undefined, formsView: undefined }
					}
				if (value === 'cleanupFailed' || value === 'failed' || value === 'drainFailed')
					return { context: { forms: undefined, formsView: undefined } }
				return {
					target: '.drainFailed',
					context: {
						forms: undefined,
						formsView: undefined,
						ready: undefined,
						...withdrawn,
						workspaces: null
					}
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
							if (context.forms) {
								enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
								return { target: '#finance-worker.retiringForms', context: next }
							}
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
							sessionRevision: context.sessionRevision + 1,
							sessionStatus: view.status
						}
						enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
						if (context.forms && context.forms.binding !== ready.binding) {
							enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
							return { target: '#finance-worker.retiringForms', context: next }
						}
						return { target: '.ready', reenter: true, context: next }
					},
					SELECT_WORKSPACE: ({ context, event }, enq) => {
						if (event.selection.revision <= context.selection.revision) return
						const next = { ...context, selection: event.selection, ...withdrawn, readBinding: {} }
						enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
						if (context.forms)
							enq.sendTo(context.forms.owner, {
								type: 'OBSERVE',
								observation: creationObservation(next),
								selectionRevision: next.selection.revision
							})
						return {
							target: context.ready ? '.ready' : '.waiting',
							reenter: true,
							context: { ...next, formsView: undefined }
						}
					},
					ACCOUNT_CREATION: ({ context, event }, enq) => {
						if (
							event.sessionRevision !== context.sessionRevision ||
							event.selection.revision !== context.selection.revision ||
							event.selection.workspaceId !== context.selection.workspaceId ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'OBSERVE',
							observation: creationObservation(context),
							selectionRevision: context.selection.revision
						})
						enq.sendTo(context.forms.owner, { type: 'ACCOUNT_CREATION', command: event.command })
					},
					ARCHIVE_ACCOUNT: ({ context, event }, enq) => {
						if (
							event.sessionRevision !== context.sessionRevision ||
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
						entry: ({ context }, enq) => {
							if (!context.ready || context.forms) return
							const binding = context.ready.binding
							const owner = enq.spawn(context.ready.capabilities.createForms(observeCreation), {
								id: 'forms',
								input: {
									observation: creationObservation(context),
									selectionRevision: context.selection.revision
								}
							})
							const observer = enq.subscribeTo(owner, {
								snapshot: (snapshot): FormsReport => ({
									type: 'FORMS_VIEW',
									binding,
									view: selectFinanceFormsView(snapshot)
								}),
								done: (): FormsReport => ({ type: 'FORMS_CLOSED', binding }),
								error: (): FormsReport => ({ type: 'FORMS_FAILED', binding })
							})
							return { context: { forms: { binding, owner, observer }, formsView: undefined } }
						},
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
									if (context.forms)
										enq.sendTo(context.forms.owner, {
											type: 'OBSERVE',
											observation: creationObservation(next),
											selectionRevision: next.selection.revision
										})
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
									if (context.forms)
										enq.sendTo(context.forms.owner, {
											type: 'OBSERVE',
											observation: creationObservation(next),
											selectionRevision: next.selection.revision
										})
									return { target: 'readFailed', context: next }
								}
							}
						],
						on: {
							WORKSPACES: ({ context, event }, enq) => {
								if (event.binding !== context.ready?.binding) return
								const next = { ...context, workspaces: event.rows }
								if (context.forms)
									enq.sendTo(context.forms.owner, {
										type: 'OBSERVE',
										observation: creationObservation(next),
										selectionRevision: context.selection.revision
									})
								return { context: { workspaces: event.rows } }
							},
							ACCOUNTS: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, accounts: event.rows }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								if (context.forms)
									enq.sendTo(context.forms.owner, {
										type: 'OBSERVE',
										observation: creationObservation(next),
										selectionRevision: next.selection.revision
									})
								return { target: '.loaded', context: { accounts: event.rows } }
							},
							MEMBERSHIP: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, membership: event.row }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								if (context.forms)
									enq.sendTo(context.forms.owner, {
										type: 'OBSERVE',
										observation: creationObservation(next),
										selectionRevision: next.selection.revision
									})
								return { context: { membership: event.row } }
							},
							GRANTS: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, grants: event.rows }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								if (context.forms)
									enq.sendTo(context.forms.owner, {
										type: 'OBSERVE',
										observation: creationObservation(next),
										selectionRevision: next.selection.revision
									})
								return { context: { grants: event.rows } }
							},
							READ_FAILED: ({ context, event }, enq) => {
								if (event.binding !== context.ready?.binding) return
								const next = { ...context, ...withdrawn, workspaces: null }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								if (context.forms)
									enq.sendTo(context.forms.owner, {
										type: 'OBSERVE',
										observation: creationObservation(next),
										selectionRevision: next.selection.revision
									})
								return { target: 'readFailed', context: next }
							},
							ACCOUNTS_FAILED: ({ context, event }, enq) => {
								if (event.binding !== context.readBinding) return
								const next = { ...context, ...withdrawn }
								enq.sendTo('archive', { type: 'OBSERVE', observation: archiveObservation(next) })
								if (context.forms)
									enq.sendTo(context.forms.owner, {
										type: 'OBSERVE',
										observation: creationObservation(next),
										selectionRevision: next.selection.revision
									})
								return { target: 'readFailed', context: next }
							}
						},
						states: { loading: {}, loaded: {} }
					},
					readFailed: {}
				}
			},
			retiringForms: {
				on: {
					FORMS_VIEW: {},
					SESSION: ({ context, event }) => {
						const observation = event.view.observation
						const ready =
							event.view.stage === 'active' && observation?.status === 'ready'
								? observation
								: undefined
						return {
							context: {
								ready,
								workspaces: null,
								...withdrawn,
								formsView: undefined,
								readBinding: {},
								sessionRevision:
									ready && ready.binding !== context.ready?.binding
										? context.sessionRevision + 1
										: context.sessionRevision,
								sessionStatus:
									event.view.stage === 'failed' ||
									event.view.stage === 'observerFailed' ||
									event.view.stage === 'openFailed'
										? 'error'
										: event.view.status
							}
						}
					},
					SELECT_WORKSPACE: ({ context, event }) =>
						event.selection.revision > context.selection.revision
							? { context: { selection: event.selection, formsView: undefined } }
							: undefined
				}
			},
			draining: {
				type: 'parallel',
				on: { CLOSE: {}, NATIVE_FAILED: {}, FORMS_VIEW: {} },
				onDone: { target: 'closingSession' },
				states: {
					archive: {
						initial: 'waiting',
						states: {
							waiting: { on: { ARCHIVE_DRAINED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					forms: {
						initial: 'assessing',
						states: {
							assessing: {
								type: 'choice',
								choice: ({ context }) => ({ target: context.forms ? 'waiting' : 'closed' })
							},
							waiting: {
								on: {
									FORMS_CLOSED: ({ context, event }, enq) => {
										if (!context.forms || event.binding !== context.forms.binding) return
										enq.stop(context.forms.observer)
										return { target: 'closed', context: { forms: undefined, formsView: undefined } }
									}
								}
							},
							closed: { type: 'final' }
						}
					}
				}
			},
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
		sessionRevision: context.sessionRevision,
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
				: null,
		accountCreation:
			snapshot.status === 'active' &&
			context.forms?.binding === context.ready?.binding &&
			context.formsView?.status === 'ready' &&
			context.formsView.selectionRevision === context.selection.revision
				? context.formsView.creation
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

export function selectFinanceAccountCreationObservation(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined
): AccountCreationObservation {
	if (snapshot?.status === 'active') return creationObservation(snapshot.context)
	return {
		identityId: null,
		organizationId: null,
		binding: null,
		sessionReady: false,
		loading: true,
		error: null,
		accounts: [],
		membership: undefined
	}
}
