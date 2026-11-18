import type {
	RestorationEvent,
	RestorationReport,
	RestorationResult,
	RestorationScope
} from 'delightful-local-first/restoration/contracts'
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
	WorkerCommandScope
} from '../../contracts/worker-application.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'
import { projectAccountArchiveFeedback } from '../../contracts/account-archive-feedback.js'
import { createFinanceFormsMachine, selectFinanceFormsView } from './worker-forms.js'
import type { AccountCreationObservation } from '../../contracts/account-creation-contract.js'
import type {
	WorkerAccountCreationCommand,
	WorkerTransactionEntryCommand,
	FinanceFormsObservation
} from '../../contracts/worker-forms.js'
import { EXPENSE, type TransactionKind } from '../../domain/transaction-kind.js'
import {
	writableTransactionAccounts,
	applicableTransactionCategories,
	applicableTransactionTags
} from '../transactions/transaction-entry.js'
import { calculateAccountBalances } from '../../domain/account-balances.js'
import { emptyLedgerFilters, selectWorkerLedger } from './worker-ledger.js'
import type { TransactionListFilters } from '../../filters/transaction-list-filters.js'
import { defaultTransactionCategory } from '../../validation/transactions.js'
import {
	financeQueriesMachine,
	selectFinanceQueryFacts,
	type FinanceQueryFacts
} from './worker-queries.js'

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
type RestorationFinished = {
	result: RestorationResult
	view: SessionRuntimeView<FinanceWorkerCapabilities>
}
type RestorationOwner = ActorRef<Snapshot<unknown>, RestorationEvent>
type Context = Input & {
	restoration: { scope: RestorationScope; owner: RestorationOwner } | undefined
	restorationOutcome: RestorationResult['outcome'] | undefined
	restorationAttempt: number
	settledRestoration: RestorationFinished | undefined
	ready: Ready | undefined
	selection: WorkerSelection
	transactionId: string | null
	transactionKind: TransactionKind
	ledgerPage: number
	ledgerFilters: TransactionListFilters
	sessionRevision: number
	facts: FinanceQueryFacts | undefined
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

function archiveObservation(context: Context): ArchiveObservation {
	return {
		identityId: context.ready?.identityId ?? null,
		organizationId: context.selection.workspaceId,
		binding: context.readBinding ?? null,
		sessionReady: context.ready !== undefined,
		loading:
			!context.facts ||
			context.facts.accounts === null ||
			context.facts.membership === undefined ||
			context.facts.grants === null,
		failed: context.facts?.status === 'failed',
		accounts: context.facts?.accounts ?? [],
		membership: context.facts?.membership,
		grants: context.facts?.grants ?? []
	}
}
function creationObservation(context: Context): AccountCreationObservation {
	const observation = archiveObservation(context)
	return {
		...observation,
		binding: context.ready?.binding ?? null,
		loading:
			!context.facts ||
			context.facts.accounts === null ||
			context.facts.membership === undefined ||
			context.facts.workspaces === null,
		error: context.facts?.status === 'failed' ? 'readFailed' : null
	}
}
function formsObservation(context: Context): FinanceFormsObservation {
	const creation = creationObservation(context),
		archive = archiveObservation(context)
	const selected = context.facts?.transaction
	const transaction = {
		...archive,
		binding: creation.binding,
		kind: context.transactionKind,
		loading:
			archive.loading ||
			!context.facts ||
			context.facts.categories === null ||
			context.facts.tags === null,
		failed: context.facts?.status === 'failed',
		categories: context.facts?.categories ?? [],
		tags: context.facts?.tags ?? []
	}
	return {
		archive,
		creation,
		transaction,
		edit: {
			...transaction,
			transactionId: context.transactionId,
			transaction:
				selected?.id === context.transactionId &&
				selected.organizationId === context.selection.workspaceId &&
				selected.kind === context.transactionKind
					? selected
					: null,
			loading:
				transaction.loading || (!!context.transactionId && context.facts?.transaction === undefined)
		}
	}
}

function sameCommandScope(context: Context, scope: WorkerCommandScope) {
	return (
		scope.sessionRevision === context.sessionRevision &&
		scope.selection.revision === context.selection.revision &&
		scope.selection.workspaceId === context.selection.workspaceId
	)
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
	observeForms
}: {
	observeForms: () => FinanceFormsObservation
}) {
	const withdrawn = { facts: undefined }
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			events: {
				REGISTER_RESTORATION: types<{
					scope: RestorationScope
					owner: RestorationOwner
					sessionRevision: number
				}>(),
				RESTORATION_VALIDATED:
					types<Omit<Extract<RestorationReport, { type: 'RESTORATION_VALIDATED' }>, 'type'>>(),
				RESTORATION_PREPARE_REQUESTED:
					types<
						Omit<Extract<RestorationReport, { type: 'RESTORATION_PREPARE_REQUESTED' }>, 'type'>
					>(),
				RESTORATION_FINISHED: types<RestorationFinished>(),
				SESSION: types<{ view: SessionRuntimeView<FinanceWorkerCapabilities> }>(),
				SELECT_CONTEXT: types<{
					selection: WorkerSelection
					kind: TransactionKind
					transactionId?: string | null | undefined
				}>(),
				TRANSACTION_ENTRY: types<{
					selection: WorkerSelection
					sessionRevision: number
					command: WorkerTransactionEntryCommand
				}>(),
				TRANSACTION_EDIT: types<WorkerCommandScope & { command: WorkerTransactionEntryCommand }>(),
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
				SET_LEDGER_PAGE: types<WorkerCommandScope & { page: number }>(),
				SET_LEDGER_FILTERS: types<WorkerCommandScope & { filters: TransactionListFilters }>(),
				CLOSE: types(),
				NATIVE_FAILED: types(),
				READ_DISPOSAL_FAILED: types()
			},
			children: {
				queries: types<ActorRefFrom<typeof financeQueriesMachine>>(),
				forms: types<ActorRefFrom<ReturnType<typeof createFinanceFormsMachine>>>()
			}
		},
		actors: {
			observeSession,
			queries: financeQueriesMachine,
			closeSession: sessionCloseMachine,
			closeStore,
			closeBroker
		}
	}).createMachine({
		id: 'finance-worker',
		initial: 'running',
		context: ({ input }) => ({
			...input,
			restoration: undefined,
			restorationOutcome: undefined,
			restorationAttempt: 0,
			settledRestoration: undefined,
			ready: undefined,
			selection: { workspaceId: null, revision: 0 },
			transactionId: null,
			transactionKind: EXPENSE,
			ledgerPage: 1,
			ledgerFilters: emptyLedgerFilters,
			sessionRevision: 0,
			facts: undefined,
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
					context: { ready: undefined, ...withdrawn }
				}
			}
		],
		on: {
			RESTORATION_VALIDATED: {},
			RESTORATION_FINISHED: ({ context, event }) => {
				if (!sameRestoration(context, event.result)) return
				return { context: { restoration: undefined, restorationOutcome: event.result.outcome } }
			},
			CLOSE: ({ context }, enq) => {
				if (context.restoration) enq.sendTo(context.restoration.owner, { type: 'SHUTDOWN' })
				if (context.forms) enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
				return {
					target: '.draining',
					context: {
						ready: undefined,
						facts: undefined,
						restoration: undefined,
						settledRestoration: undefined
					}
				}
			},
			FORMS_VIEW: ({ context, event }) =>
				event.binding === context.forms?.binding &&
				event.view.selectionRevision === context.selection.revision
					? event.view.status === 'failed'
						? {
								target: '.drainFailed',
								context: { formsView: undefined, ready: undefined, ...withdrawn }
							}
						: { context: { formsView: event.view } }
					: undefined,
			FORMS_FAILED: ({ context, event }) =>
				event.binding === context.forms?.binding
					? {
							target: '.drainFailed',
							context: { formsView: undefined, ready: undefined, ...withdrawn }
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
						...withdrawn
					}
				}
			},
			READ_DISPOSAL_FAILED: {
				target: '.cleanupFailed',
				context: { ready: undefined, ...withdrawn }
			},
			NATIVE_FAILED: {
				target: '.failed',
				context: { ready: undefined, ...withdrawn }
			}
		},
		states: {
			running: {
				initial: 'waiting',
				on: {
					REGISTER_RESTORATION: ({ context, event }) => {
						if (
							context.restoration ||
							event.scope.binding !== context.session.binding ||
							event.sessionRevision !== context.sessionRevision ||
							event.scope.attempt <= context.restorationAttempt
						)
							return
						return {
							context: {
								restoration: { scope: event.scope, owner: event.owner },
								restorationAttempt: event.scope.attempt,
								restorationOutcome: undefined
							}
						}
					},
					RESTORATION_VALIDATED: {},
					RESTORATION_PREPARE_REQUESTED: ({ context, event }, enq) => {
						if (!sameRestoration(context, event)) return
						if (context.forms) enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
						return {
							target: '#finance-worker.restoring.draining',
							context: {
								ready: undefined,
								facts: undefined,
								formsView: undefined,
								readBinding: undefined,
								sessionRevision: context.sessionRevision + 1
							}
						}
					},
					SESSION: ({ context, event }, enq) => {
						const view = event.view,
							ready = view.observation
						if (
							context.restoration &&
							(context.ready
								? ready?.status !== 'ready' || ready.binding !== context.ready.binding
								: view.status !== context.sessionStatus)
						)
							enq.sendTo(context.restoration.owner, { type: 'BINDING_INVALIDATED' })
						if (
							view.stage === 'failed' ||
							view.stage === 'closed' ||
							view.stage === 'openFailed' ||
							view.stage === 'observerFailed'
						) {
							const next = {
								...context,
								ready: undefined,
								...withdrawn,
								sessionStatus: view.status
							}
							return { target: '#finance-worker.failed', context: next }
						}
						if (ready?.status !== 'ready') {
							const next = {
								...context,
								ready: undefined,
								...withdrawn,
								sessionStatus: view.status
							}
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
							...withdrawn,
							readBinding: {},
							sessionRevision: context.sessionRevision + 1,
							transactionId: null,
							ledgerFilters: emptyLedgerFilters,
							ledgerPage: 1,
							sessionStatus: view.status
						}
						if (context.forms && context.forms.binding !== ready.binding) {
							enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
							return { target: '#finance-worker.retiringForms', context: next }
						}
						return { target: '.ready', reenter: true, context: next }
					},
					SELECT_CONTEXT: ({ context, event }, enq) => {
						if (event.selection.revision <= context.selection.revision) return
						const readBinding = {}
						const next = {
							...context,
							selection: event.selection,
							transactionKind: event.kind,
							transactionId: event.transactionId ?? null,
							ledgerPage:
								event.selection.workspaceId === context.selection.workspaceId &&
								event.kind === context.transactionKind
									? context.ledgerPage
									: 1,
							readBinding,
							facts: context.facts
								? ({
										...context.facts,
										binding: readBinding,
										status: 'loading',
										accounts: null,
										membership: undefined,
										grants: null,
										categories: null,
										tags: null,
										transaction: undefined,
										transactions: null
									} satisfies FinanceQueryFacts)
								: undefined
						}
						if (context.forms)
							enq.sendTo(context.forms.owner, {
								type: 'OBSERVE',
								observation: formsObservation(next),
								selectionRevision: next.selection.revision
							})
						return {
							target: context.ready ? '.ready' : '.waiting',
							reenter: true,
							context: { ...next, formsView: undefined }
						}
					},
					SET_LEDGER_PAGE: ({ context, event }) =>
						sameCommandScope(context, event) ? { context: { ledgerPage: event.page } } : undefined,
					SET_LEDGER_FILTERS: ({ context, event }) =>
						sameCommandScope(context, event)
							? { context: { ledgerFilters: event.filters, ledgerPage: 1 } }
							: undefined,
					ACCOUNT_CREATION: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'OBSERVE',
							observation: formsObservation(context),
							selectionRevision: context.selection.revision
						})
						enq.sendTo(context.forms.owner, { type: 'ACCOUNT_CREATION', command: event.command })
					},
					TRANSACTION_EDIT: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'OBSERVE',
							observation: formsObservation(context),
							selectionRevision: context.selection.revision
						})
						enq.sendTo(context.forms.owner, { type: 'TRANSACTION_EDIT', command: event.command })
					},
					TRANSACTION_ENTRY: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'OBSERVE',
							observation: formsObservation(context),
							selectionRevision: context.selection.revision
						})
						enq.sendTo(context.forms.owner, { type: 'TRANSACTION_ENTRY', command: event.command })
					},
					ARCHIVE_ACCOUNT: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'OBSERVE',
							observation: formsObservation(context),
							selectionRevision: context.selection.revision
						})
						enq.sendTo(context.forms.owner, { type: 'ARCHIVE_ACCOUNT', accountId: event.accountId })
					}
				},
				states: {
					waiting: {},
					ready: {
						entry: ({ context }, enq) => {
							if (!context.ready || context.forms) return
							const binding = context.ready.binding
							const owner = enq.spawn(
								context.ready.capabilities.createForms(
									observeForms,
									context.ready.capabilities.archiveAccount
								),
								{
									id: 'forms',
									input: {
										observation: formsObservation(context),
										selectionRevision: context.selection.revision
									}
								}
							)
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
						invoke: {
							id: 'queries',
							src: 'queries',
							input: ({ context, self }) => ({
								ready: required(context.ready),
								initialWorkspaces: context.facts?.workspaces ?? null,
								selection: context.selection,
								transactionId: context.transactionId,
								binding: required(context.readBinding),
								reportDisposalFailure: () => self.send({ type: 'READ_DISPOSAL_FAILED' })
							}),
							onSnapshot: ({ context, event }, enq) => {
								const facts = selectFinanceQueryFacts(event.snapshot)
								if (facts.binding !== context.readBinding) return
								const next = { ...context, facts }
								if (context.forms)
									enq.sendTo(context.forms.owner, {
										type: 'OBSERVE',
										observation: formsObservation(next),
										selectionRevision: context.selection.revision
									})
								return facts.status === 'failed'
									? { target: 'readFailed', context: { facts } }
									: { context: { facts } }
							},
							onError: { target: 'readFailed', context: withdrawn }
						}
					},
					readFailed: {}
				}
			},
			restoring: {
				initial: 'draining',
				on: {
					SESSION: {},
					SELECT_CONTEXT: ({ context, event }) =>
						event.selection.revision > context.selection.revision
							? {
									context: {
										selection: { workspaceId: null, revision: event.selection.revision },
										transactionKind: event.kind
									}
								}
							: undefined,
					FORMS_VIEW: {},
					RESTORATION_VALIDATED: {},
					RESTORATION_PREPARE_REQUESTED: {},
					RESTORATION_FINISHED: ({ context, event, value }) => {
						if (!sameRestoration(context, event.result)) return
						return matchesState({ restoring: 'mutating' }, value)
							? { target: '.resuming', context: { settledRestoration: event } }
							: { context: { settledRestoration: event } }
					}
				},
				states: {
					draining: {
						initial: 'assessing',
						states: {
							assessing: {
								type: 'choice',
								choice: ({ context }) => ({
									target: context.forms ? 'waiting' : '#finance-worker.restoring.prepared'
								})
							},
							waiting: {
								on: {
									FORMS_CLOSED: ({ context, event }, enq) => {
										if (!context.forms || event.binding !== context.forms.binding) return
										enq.stop(context.forms.observer)
										return {
											target: '#finance-worker.restoring.prepared',
											context: { forms: undefined, formsView: undefined }
										}
									}
								}
							}
						}
					},
					prepared: {
						type: 'choice',
						choice: ({ context }) => ({
							target: context.settledRestoration ? 'resuming' : 'mutating'
						})
					},
					mutating: {
						entry: ({ context }, enq) => {
							if (context.restoration)
								enq.sendTo(context.restoration.owner, {
									type: 'PREPARED',
									...context.restoration.scope
								})
						}
					},
					resuming: {
						type: 'choice',
						choice: ({ context }) => {
							const settled = required(context.settledRestoration),
								view = settled.view
							const ready =
								view.stage === 'active' && view.observation?.status === 'ready'
									? view.observation
									: undefined
							return {
								target:
									view.stage === 'active'
										? ready
											? '#finance-worker.running.ready'
											: '#finance-worker.running.waiting'
										: '#finance-worker.failed',
								context: {
									ready,
									sessionStatus: view.status,
									readBinding: {},
									restoration: undefined,
									settledRestoration: undefined,
									restorationOutcome: settled.result.outcome,
									selection: { workspaceId: null, revision: context.selection.revision },
									transactionId: null,
									ledgerPage: 1,
									ledgerFilters: emptyLedgerFilters
								}
							}
						}
					}
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
								ledgerFilters:
									ready && ready.binding !== context.ready?.binding
										? emptyLedgerFilters
										: context.ledgerFilters,
								ledgerPage:
									ready && ready.binding !== context.ready?.binding ? 1 : context.ledgerPage,
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
					SELECT_CONTEXT: ({ context, event }) =>
						event.selection.revision > context.selection.revision
							? {
									context: {
										selection: event.selection,
										transactionKind: event.kind,
										transactionId: event.transactionId ?? null,
										formsView: undefined
									}
								}
							: undefined
				}
			},
			draining: {
				initial: 'assessing',
				on: { CLOSE: {}, NATIVE_FAILED: {}, FORMS_VIEW: {} },
				states: {
					assessing: {
						type: 'choice',
						choice: ({ context }) => ({
							target: context.forms ? 'waiting' : '#finance-worker.closingSession'
						})
					},
					waiting: {
						on: {
							FORMS_CLOSED: ({ context, event }, enq) => {
								if (!context.forms || event.binding !== context.forms.binding) return
								enq.stop(context.forms.observer)
								return {
									target: '#finance-worker.closingSession',
									context: { forms: undefined, formsView: undefined }
								}
							}
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
				: snapshot.matches('restoring')
					? 'loading'
					: context.ready
						? context.facts?.status !== 'ready'
							? 'loading'
							: 'ready'
						: context.sessionStatus === 'signed-out'
							? 'signed-out'
							: 'starting'
	const balances =
		context.facts?.accounts && context.facts.transactions
			? calculateAccountBalances(context.facts.accounts, context.facts.transactions)
			: null
	const observations = formsObservation(context)
	const transactionFacts = observations.transaction
	const edited = observations.edit.transaction
	const transactionAccounts = writableTransactionAccounts({
		...transactionFacts,
		accounts: context.facts?.accounts ?? []
	})
	const forms =
		snapshot.status === 'active' &&
		context.forms?.binding === context.ready?.binding &&
		context.formsView?.status === 'ready' &&
		context.formsView.selectionRevision === context.selection.revision
			? context.formsView
			: undefined

	const archive = forms?.archive

	return {
		type: 'VIEW',
		sessionRevision: context.sessionRevision,
		transactionKind: context.transactionKind,
		transactionId: context.transactionId,
		selection: context.selection,
		status,
		identityRestore: {
			canSubmit:
				snapshot.status === 'active' &&
				snapshot.matches('running') &&
				!context.restoration &&
				(context.ready !== undefined || context.sessionStatus === 'signed-out'),
			busy: context.restoration !== undefined,
			error:
				context.restorationOutcome === 'invalid' ||
				context.restorationOutcome === 'failed' ||
				context.restorationOutcome === 'identityUnavailable',
			draftRevision: context.restorationAttempt
		},
		recoveryAvailable:
			snapshot.status === 'active' &&
			snapshot.matches('running') &&
			context.ready?.identityKind === 'device',
		identityId: snapshot.status === 'active' ? (context.ready?.identityId ?? null) : null,
		workspaces: snapshot.status === 'active' ? (context.facts?.workspaces ?? null) : null,
		accounts:
			snapshot.status === 'active'
				? (context.facts?.accounts ?? []).map(({ id, name, kind, currency }) => ({
						id,
						name,
						kind,
						currency,
						balanceMinor: balances?.get(id) ?? null,
						archiveAction:
							archive && archive.binding === context.readBinding
								? (archive.view.rows.find((row) => row.account.id === id)?.action ?? 'unavailable')
								: 'unavailable'
					}))
				: [],
		archiveFeedback:
			snapshot.status === 'active' && archive && archive.binding === context.readBinding
				? projectAccountArchiveFeedback(archive.view.feedback)
				: null,
		workspaceStartup: forms?.initialization ?? null,
		accountCreation: forms?.creation ?? null,
		ledger:
			snapshot.status === 'active'
				? selectWorkerLedger(
						context.facts,
						context.transactionKind,
						context.ledgerFilters,
						context.ledgerPage
					)
				: null,
		transactionEdit:
			forms && context.transactionId
				? {
						transactionId: context.transactionId,
						kind: context.transactionKind,
						form: forms.edit,
						accounts: transactionAccounts,
						categories: applicableTransactionCategories(transactionFacts),
						tagSuggestions: applicableTransactionTags(transactionFacts).map((tag) => tag.name),
						defaultAccountId: edited?.accountId ?? null,
						defaultCategoryId: edited?.categoryId ?? null,
						initialTransaction: edited
							? {
									accountId: edited.accountId,
									categoryId: edited.categoryId,
									amountMinor: edited.amountMinor,
									currency: edited.currency,
									bookedOn: edited.bookedOn,
									description: edited.description,
									memo: edited.memo,
									paymentMethod: edited.paymentMethod,
									checkId: edited.checkId,
									...(edited.check
										? {
												check: {
													checkNumber: edited.check.checkNumber,
													checkDate: edited.check.checkDate
												}
											}
										: {}),
									tags: edited.tags?.flatMap((link) => (link.tag ? [link.tag.name] : [])) ?? []
								}
							: null
					}
				: null,
		transactionEntry: forms
			? {
					kind: context.transactionKind,
					form: forms.transaction,
					accounts: transactionAccounts,
					categories: applicableTransactionCategories(transactionFacts),
					tagSuggestions: applicableTransactionTags(transactionFacts).map((tag) => tag.name),
					defaultAccountId: transactionAccounts[0]?.id ?? null,
					defaultCategoryId: defaultTransactionCategory(transactionFacts)?.id ?? null
				}
			: null
	}
}

function selectFinanceArchiveObservation(
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

export function selectFinanceFormObservations(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined
): FinanceFormsObservation {
	if (snapshot?.status === 'active') return formsObservation(snapshot.context)
	const archive = selectFinanceArchiveObservation(undefined)
	return {
		archive,
		creation: { ...archive, error: null },
		transaction: { ...archive, kind: EXPENSE, categories: [], tags: [] },
		edit: {
			...archive,
			kind: EXPENSE,
			categories: [],
			tags: [],
			transactionId: null,
			transaction: null
		}
	}
}

/** Only an active, current device-account binding can export. The secret is never actor state. */
export function selectFinanceRecoveryReader(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined,
	sessionRevision: number
) {
	return snapshot?.status === 'active' &&
		snapshot.matches('running') &&
		snapshot.context.sessionRevision === sessionRevision &&
		snapshot.context.ready?.identityKind === 'device'
		? snapshot.context.ready.capabilities.readRecoveryPhrase
		: undefined
}

function sameRestoration(context: Context, scope: RestorationScope) {
	return (
		context.restoration?.scope.binding === scope.binding &&
		context.restoration.scope.attempt === scope.attempt
	)
}
/** Host admission before constructing any private phrase-bearing actor. */
export function selectFinanceRestorationAdmission(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined,
	revision: number
) {
	return snapshot?.status === 'active' &&
		snapshot.matches('running') &&
		!snapshot.context.restoration &&
		snapshot.context.sessionRevision === revision &&
		(snapshot.context.ready !== undefined || snapshot.context.sessionStatus === 'signed-out')
		? {
				session: snapshot.context.session,
				scope: {
					binding: snapshot.context.session.binding,
					attempt: snapshot.context.restorationAttempt + 1
				}
			}
		: undefined
}
