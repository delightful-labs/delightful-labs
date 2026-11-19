import { workerAccount } from '../../contracts/worker-application.js'
import { debugEnabled } from '../../diagnostics/logger.js'
import type { WorkerBankCommand, WorkerBankHistoryCommand } from '../../contracts/worker-banks.js'
import type { WorkerTransactionImageCommand } from '../../contracts/worker-images.js'
import { selectWorkerTransfers } from './worker-transfers.js'
import { transferIdForPath } from '../../domain/transaction-list-routes.js'
import { selectInternalTransferEntryAccounts } from '../transfers/internal-transfer-entry.js'
import {
	rejectedTransferMutation,
	type TransferMutationRequest
} from '../transfers/internal-transfer-mutation-owner.js'
import type { WorkerTransferEditCommand } from '../../contracts/worker-transfers.js'
import { selectWorkerOverview } from './worker-overview.js'
import type { BackupSubmission } from '../../backup/submission.js'
import type {
	WorkspaceRestoreFile,
	WorkspaceRestoreCommand
} from '../workspaces/workspace-restore.js'
import type { WorkerWorkspaceCreationCommand } from '../../contracts/worker-forms.js'
import { classificationCounts } from '../../domain/classification-counts.js'
import { selectManagementArchiveIds } from '../management/management.js'
import type { ClassificationForm } from '../../contracts/worker-forms.js'
import { orderAccounts } from '../accounts/account-order.js'
import type { AccountOrderStorage } from '../../contracts/worker-forms.js'
import type { WorkerAccountOrderCommand } from '../../contracts/worker-forms.js'
import { toggleSelectedAccount } from '../../filters/finance-filters.js'
import {
	transactionListLocation,
	transactionListQuery,
	transactionIdForPath
} from '../../domain/transaction-list-routes.js'
import { withQueryParams } from '../../domain/query-params.js'
import { workspaceRoute, workspaceHref } from '../../domain/workspace-routes.js'
import { transactionKindForPath, transactionPages } from '../../domain/transaction-kind.js'
import type {
	WorkspaceNavigationFacts,
	WorkspaceRoute,
	WorkspaceNavigate
} from '../../contracts/workspace-orchestration-contract.js'
import type {
	RecoveryResult,
	RecoveryNavigation,
	RecoveryNotice
} from 'delightful-local-first/recovery/coordination'
import type { FinanceRecoveryFinished } from '../../contracts/worker-recovery.js'
import type { RestorationScope } from 'delightful-local-first/restoration/contracts'
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
import type { WorkerFormCommand, FinanceFormsObservation } from '../../contracts/worker-forms.js'
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
	accountOrderStorage: AccountOrderStorage
	session: FinanceWorkerSession
	closeAccountStore: () => Promise<void>
	closeBroker: () => Promise<WorkerHostClosed>
	brokerIdentity: WorkerHostClosed
	navigate: WorkspaceNavigate
}
type RestorationFinished = Omit<FinanceRecoveryFinished, 'type'>
type RestorationOwner = ActorRef<Snapshot<unknown>, { type: 'SHUTDOWN' | 'WORKSPACE_DRAINED' }>
type Context = Input & {
	offline: boolean
	restoration:
		| { scope: RestorationScope; owner: RestorationOwner; operation: 'restore' | 'navigate' }
		| undefined
	recoveryNavigation: RecoveryNavigation | undefined
	href: string | undefined
	route: WorkspaceRoute | undefined
	restorationOutcome: RecoveryResult['outcome'] | undefined
	restorationAttempt: number
	settledRestoration: RestorationFinished | undefined
	ready: Ready | undefined
	selection: WorkerSelection
	transactionId: string | null
	transactionKind: TransactionKind
	ledgerPage: number
	selectedAccountIds: string[] | null
	overviewFilters: TransactionListFilters | undefined
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
		accounts: context.facts?.accounts?.filter((account) => !account.archivedAt) ?? [],
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
function navigationObservation(context: Context): WorkspaceNavigationFacts {
	const route = context.route ?? { pathname: '/', search: '', hash: '' },
		selected = workspaceRoute(route.search)
	const member = context.facts?.membership
	const access =
		context.facts?.status === 'failed'
			? 'failed'
			: selected.scoped && !selected.workspaceId
				? 'denied'
				: member === undefined
					? 'waiting'
					: member?.userId === context.ready?.identityId &&
						  member?.organizationId === selected.workspaceId
						? 'ready'
						: 'denied'
	return {
		...route,
		generation: context.selection.revision,
		userId: context.ready?.identityId,
		ready: context.route !== undefined && context.ready !== undefined,
		loading: context.facts?.workspaces == null,
		error: context.facts?.status === 'failed' ? 'readFailed' : undefined,
		organizations: context.facts?.workspaces ?? [],
		access
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
		sampleSelectedAccounts: context.selectedAccountIds,
		bank: {
			organizationId: creation.organizationId,
			userId: creation.identityId ?? undefined,
			sessionReady: creation.sessionReady,
			membership: creation.membership,
			connections: context.facts?.bankConnections ?? [],
			accounts: context.facts?.accounts ?? [],
			links: context.facts?.bankLinks ?? []
		},
		transferCreate: transaction,
		transfers: {
			rows: context.facts?.transfers ?? [],
			transactions: context.facts?.transactions ?? [],
			loading: context.facts?.transfers == null || context.facts?.transactions == null,
			failed: context.facts?.status === 'failed'
		},
		accountAccess: {
			...archive,
			accounts: context.facts?.accounts?.filter((account) => !account.archivedAt) ?? [],
			members: context.facts?.workspaceMembers ?? [],
			grants: context.facts?.accountGrants ?? [],
			loading:
				archive.loading ||
				context.facts?.workspaceMembers == null ||
				context.facts?.accountGrants == null
		},
		backup: {
			identityId: creation.identityId,
			workspaceId: creation.organizationId,
			membershipId: context.facts?.membership?.id ?? null,
			memberUserId: context.facts?.membership?.userId ?? null,
			ownerId: context.facts?.workspace?.ownerId ?? null,
			role: context.facts?.membership?.role ?? null,
			access: context.facts?.membership?.accountAccessMode ?? null,
			sessionReady: creation.sessionReady,
			attached: creation.binding !== null,
			loading: context.facts?.workspace === undefined || context.facts?.membership === undefined,
			failed: context.facts?.status === 'failed'
		},
		profile: {
			identityId: creation.identityId,
			binding: creation.binding,
			sessionReady: creation.sessionReady,
			loading: context.facts?.profile === undefined,
			failed: context.facts?.status === 'failed',
			profile: context.facts?.profile
		},
		workspace: {
			identityId: creation.identityId,
			binding: creation.binding,
			organizationId: creation.organizationId,
			sessionReady: creation.sessionReady,
			workspaceLoading: !!creation.organizationId && context.facts?.workspace === undefined,
			membershipLoading: context.facts?.membership === undefined,
			workspaceError: context.facts?.status === 'failed',
			membershipError: context.facts?.status === 'failed',
			workspace: context.facts?.workspace,
			membership: context.facts?.membership
		},
		classification: {
			binding: creation.binding,
			identityId: creation.identityId,
			organizationId: creation.organizationId,
			sessionReady: creation.sessionReady,
			membership: creation.membership,
			loading:
				!context.facts ||
				context.facts.membership === undefined ||
				context.facts.categories === null ||
				context.facts.tags === null,
			failed: context.facts?.status === 'failed',
			categories: context.facts?.categories ?? [],
			tags: context.facts?.tags ?? []
		},
		order: {
			key:
				context.ready?.identityId && context.selection.workspaceId
					? JSON.stringify([context.ready.identityId, context.selection.workspaceId])
					: null,
			ids: context.facts?.accounts?.map((account) => account.id) ?? []
		},
		navigation: navigationObservation(context),
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

function transactionContextForRoute(route: WorkspaceRoute | undefined) {
	const location = route ? transactionListLocation(route.search) : undefined
	return {
		transactionId: route ? transactionIdForPath(route.pathname) : null,
		ledgerFilters: location?.filters ?? emptyLedgerFilters,
		ledgerPage: location?.requestedPage ?? 1
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
					operation: 'restore' | 'navigate'
					sessionRevision: number
				}>(),
				RECOVERY_VALIDATED:
					types<Omit<Extract<RecoveryNotice, { type: 'RECOVERY_VALIDATED' }>, 'type'>>(),
				RECOVERY_DRAIN_REQUESTED:
					types<Omit<Extract<RecoveryNotice, { type: 'RECOVERY_DRAIN_REQUESTED' }>, 'type'>>(),
				RESTORATION_FINISHED: types<RestorationFinished>(),
				RESTORATION_FAILED: types<RestorationScope>(),
				OBSERVE_LOCATION: types<{ href: string }>(),
				OBSERVE_NETWORK: types<{ offline: boolean }>(),
				OBSERVE_ROUTE: types<WorkspaceRoute & { revision: number }>(),
				NAVIGATE_WORKSPACE: types<WorkerCommandScope & { workspaceId: string }>(),
				RETRY_WORKSPACE_NAVIGATION: types<WorkerCommandScope>(),
				SESSION: types<{ view: SessionRuntimeView<FinanceWorkerCapabilities> }>(),
				SELECT_CONTEXT: types<{
					selection: WorkerSelection
					kind: TransactionKind
					transactionId?: string | null | undefined
				}>(),
				TRANSACTION_ENTRY: types<{
					selection: WorkerSelection
					sessionRevision: number
					command: WorkerFormCommand
				}>(),
				TRANSFER_MUTATION_REQUEST: types<{ request: TransferMutationRequest }>(),
				CANCEL_TRANSFER_MUTATION: types<{ requestId: string }>(),
				ADD_SAMPLES: types<WorkerCommandScope & { kind: TransactionKind }>(),
				RETRY_SESSION: types(),
				RETRY_INITIALIZATION: types<WorkerCommandScope>(),
				RETRY_INTEGRITY: types<WorkerCommandScope>(),
				DISMISS_MUTATION_NOTICE: types<WorkerCommandScope>(),
				BANK_HISTORY: types<WorkerCommandScope & { command: WorkerBankHistoryCommand }>(),
				BANK: types<WorkerCommandScope & { command: WorkerBankCommand }>(),
				TRANSACTION_IMAGE: types<WorkerCommandScope & { command: WorkerTransactionImageCommand }>(),
				TRANSFER_EDIT: types<WorkerCommandScope & { command: WorkerTransferEditCommand }>(),
				TRANSFER_ENTRY: types<WorkerCommandScope & { command: WorkerFormCommand }>(),
				TRANSACTION_EDIT: types<WorkerCommandScope & { command: WorkerFormCommand }>(),
				ARCHIVE_ACCOUNT: types<{
					selection: WorkerSelection
					sessionRevision: number
					accountId: string
				}>(),
				SET_OVERVIEW_FILTERS: types<WorkerCommandScope & { filters: TransactionListFilters }>(),
				SET_ACCOUNT_DELETE_GRANT: types<
					WorkerCommandScope & { accountId: string; userId: string; canDelete: boolean }
				>(),
				START_BACKUP: types<WorkerCommandScope & { submission: BackupSubmission }>(),
				START_WORKSPACE_RESTORE: types<WorkerCommandScope & { request: WorkspaceRestoreFile }>(),
				BACKUP_COMMAND: types<WorkerCommandScope & { command: 'CANCEL' | 'RELOAD' }>(),
				WORKSPACE_RESTORE_COMMAND: types<
					WorkerCommandScope & { command: WorkspaceRestoreCommand['type'] }
				>(),
				WORKSPACE_CREATION: types<
					WorkerCommandScope & { command: WorkerWorkspaceCreationCommand }
				>(),
				PROFILE: types<
					WorkerCommandScope & { form: 'name' | 'avatar'; command: WorkerFormCommand }
				>(),
				WORKSPACE_SETTINGS: types<WorkerCommandScope & { command: WorkerFormCommand }>(),
				CLASSIFICATION: types<
					WorkerCommandScope & { form: ClassificationForm; command: WorkerFormCommand }
				>(),
				ACCOUNT_ORDER: types<WorkerCommandScope & { command: WorkerAccountOrderCommand }>(),
				ACCOUNT_CREATION: types<{
					selection: WorkerSelection
					sessionRevision: number
					command: WorkerFormCommand
				}>(),
				FORMS_VIEW: types<{ binding: object; view: ReturnType<typeof selectFinanceFormsView> }>(),
				FORMS_CLOSED: types<{ binding: object }>(),
				FORMS_FAILED: types<{ binding: object }>(),
				OPEN_TRANSACTION: types<WorkerCommandScope & { transactionId: string | null }>(),
				SET_ACCOUNT_SELECTED: types<WorkerCommandScope & { accountId: string; checked: boolean }>(),
				SET_ALL_ACCOUNTS_SELECTED: types<WorkerCommandScope & { checked: boolean }>(),
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
			offline: true,
			recoveryNavigation: undefined,
			href: undefined,
			route: undefined,
			restoration: undefined,
			restorationOutcome: undefined,
			restorationAttempt: 0,
			settledRestoration: undefined,
			ready: undefined,
			selection: { workspaceId: null, revision: 0 },
			overviewFilters: undefined,
			transactionId: null,
			transactionKind: EXPENSE,
			ledgerPage: 1,
			selectedAccountIds: null,
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
			START_BACKUP: ({ event }, enq) => enq(() => event.submission.release()),
			START_WORKSPACE_RESTORE: ({ event }, enq) => enq(() => event.request.release()),
			TRANSFER_MUTATION_REQUEST: ({ context, event }, enq) => {
				if (context.forms && context.forms.binding === context.ready?.binding) {
					enq.sendTo(context.forms.owner, event)
				} else
					enq(() =>
						event.request.recipient.send({
							type: 'TRANSFER_MUTATION_RESULT',
							requestId: event.request.requestId,
							result: rejectedTransferMutation(event.request)
						})
					)
			},
			CANCEL_TRANSFER_MUTATION: ({ context, event }, enq) => {
				if (context.forms) enq.sendTo(context.forms.owner, event)
			},
			RECOVERY_VALIDATED: {},
			OBSERVE_LOCATION: ({ event }) => ({ context: { href: event.href } }),
			OBSERVE_NETWORK: ({ context, event }, enq) => {
				if (context.forms)
					enq.sendTo(context.forms.owner, { type: 'BANK_NETWORK', offline: event.offline })
				return { context: { offline: event.offline } }
			},
			OBSERVE_ROUTE: ({ context, event }, enq) => {
				if (event.revision <= context.selection.revision) return
				const route = { pathname: event.pathname, search: event.search, hash: event.hash }
				enq.raise({
					type: 'SELECT_CONTEXT',
					selection: {
						workspaceId: workspaceRoute(event.search).workspaceId,
						revision: event.revision
					},
					kind: transactionKindForPath(event.pathname),
					transactionId: transactionIdForPath(event.pathname)
				})
				return { context: { route, href: `${route.pathname}${route.search}${route.hash}` } }
			},
			RESTORATION_FAILED: ({ context, event }) =>
				sameRestoration(context, event)
					? {
							target: '.failed',
							context: { restoration: undefined, ready: undefined, facts: undefined }
						}
					: undefined,
			RESTORATION_FINISHED: ({ context, event }) => {
				if (!sameRestoration(context, event.scope)) return
				const completed = {
					restoration: undefined,
					restorationOutcome: event.result.outcome,
					recoveryNavigation:
						event.result.outcome === 'navigationFailed' ? event.result.navigation : undefined
				}
				return event.result.outcome === 'restorationChildFailed'
					? { target: '.failed', context: { ...completed, ready: undefined, facts: undefined } }
					: { context: completed }
			},
			CLOSE: ({ context }, enq) => {
				if (context.restoration) enq.sendTo(context.restoration.owner, { type: 'SHUTDOWN' })
				if (context.forms) enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
				return {
					target: '.draining',
					context: {
						ready: undefined,
						facts: undefined,
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
						: event.view.status === 'loading' &&
							  context.formsView?.status === 'ready' &&
							  context.formsView.selectionRevision === event.view.selectionRevision
							? // Keep the current scope's form DOM mounted while its fixed children publish updates.
								// Commands still go through the latest observations and native admission guards.
								undefined
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
								restoration: { scope: event.scope, owner: event.owner, operation: event.operation },
								recoveryNavigation: undefined,
								restorationAttempt: event.scope.attempt,
								restorationOutcome: undefined
							}
						}
					},
					RECOVERY_VALIDATED: {},
					RECOVERY_DRAIN_REQUESTED: ({ context, event }, enq) => {
						if (event.attempt !== context.restoration?.scope.attempt) return
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
							enq.sendTo(context.restoration.owner, { type: 'SHUTDOWN' })
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
							overviewFilters: undefined,
							...transactionContextForRoute(context.route),
							selectedAccountIds: null,
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
						const retainReads =
							context.route !== undefined &&
							context.facts !== undefined &&
							context.facts.status !== 'failed' &&
							event.selection.workspaceId === context.selection.workspaceId &&
							event.kind === context.transactionKind &&
							(event.transactionId ?? null) === context.transactionId
						const readBinding = retainReads ? required(context.readBinding) : {}
						const location = context.route
							? transactionListLocation(context.route.search)
							: undefined
						const next = {
							...context,
							selection: event.selection,
							overviewFilters:
								event.selection.workspaceId === context.selection.workspaceId
									? context.overviewFilters
									: undefined,
							selectedAccountIds:
								event.selection.workspaceId === context.selection.workspaceId
									? context.selectedAccountIds
									: null,
							transactionKind: event.kind,
							transactionId: event.transactionId ?? null,
							ledgerFilters: location?.filters ?? context.ledgerFilters,
							ledgerPage:
								location?.requestedPage ??
								(event.selection.workspaceId === context.selection.workspaceId &&
								event.kind === context.transactionKind
									? context.ledgerPage
									: 1),
							readBinding,
							facts: retainReads
								? context.facts
								: context.facts
									? ({
											...context.facts,
											binding: readBinding,
											status: 'loading',
											bankConnections: null,
											bankLinks: null,
											transfers: null,
											workspaceMembers: null,
											accountGrants: null,
											workspace: undefined,
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
						if (retainReads) return { context: next }
						return {
							target: context.ready ? '.ready' : '.waiting',
							reenter: true,
							context: { ...next, formsView: undefined }
						}
					},
					NAVIGATE_WORKSPACE: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.route ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'SELECT_WORKSPACE',
							workspaceId: event.workspaceId
						})
					},
					RETRY_WORKSPACE_NAVIGATION: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.route ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'RETRY_NAVIGATION' })
					},
					OPEN_TRANSACTION: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.route ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding ||
							!context.selection.workspaceId
						)
							return
						if (
							event.transactionId !== null &&
							!context.facts?.transactions?.some(
								(row) =>
									row.id === event.transactionId &&
									row.organizationId === context.selection.workspaceId &&
									row.kind === context.transactionKind
							)
						)
							return
						const path = transactionPages[context.transactionKind].path
						enq.sendTo(context.forms.owner, {
							type: 'NAVIGATE',
							replace: false,
							destination: withQueryParams(
								workspaceHref(
									context.selection.workspaceId,
									event.transactionId ? `${path}/${encodeURIComponent(event.transactionId)}` : path
								),
								transactionListQuery(context.ledgerFilters, context.ledgerPage)
							)
						})
					},
					SET_ACCOUNT_SELECTED: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.facts?.accounts?.some(
								(account) => account.id === event.accountId && !account.archivedAt
							)
						)
							return
						if (
							context.route &&
							context.forms &&
							new URLSearchParams(context.route.search).has('page')
						)
							enq.sendTo(context.forms.owner, {
								type: 'NAVIGATE',
								replace: true,
								destination: withQueryParams(
									`${context.route.pathname}${context.route.search}${context.route.hash}`,
									{ page: null }
								)
							})
						return {
							context: {
								selectedAccountIds: toggleSelectedAccount(
									context.selectedAccountIds,
									context.facts.accounts,
									event.accountId,
									event.checked
								),
								ledgerPage: 1
							}
						}
					},
					SET_ALL_ACCOUNTS_SELECTED: ({ context, event }, enq) => {
						if (!sameCommandScope(context, event) || !context.facts?.accounts) return
						if (
							context.route &&
							context.forms &&
							new URLSearchParams(context.route.search).has('page')
						)
							enq.sendTo(context.forms.owner, {
								type: 'NAVIGATE',
								replace: true,
								destination: withQueryParams(
									`${context.route.pathname}${context.route.search}${context.route.hash}`,
									{ page: null }
								)
							})
						return { context: { selectedAccountIds: event.checked ? null : [], ledgerPage: 1 } }
					},
					SET_LEDGER_PAGE: ({ context, event }, enq) => {
						if (!sameCommandScope(context, event)) return
						if (context.route && context.forms) {
							enq.sendTo(context.forms.owner, {
								type: 'NAVIGATE',
								replace: false,
								destination: withQueryParams(
									`${context.route.pathname}${context.route.search}${context.route.hash}`,
									{ page: event.page > 1 ? event.page : null }
								)
							})
							return
						}
						return { context: { ledgerPage: event.page } }
					},
					SET_LEDGER_FILTERS: ({ context, event }) => {
						if (!sameCommandScope(context, event)) return
						if (context.route) return
						return { context: { ledgerFilters: event.filters, ledgerPage: 1 } }
					},
					SET_OVERVIEW_FILTERS: ({ context, event }, enq) => {
						if (!sameCommandScope(context, event)) return
						if (
							context.overviewFilters &&
							Object.entries(event.filters).every(
								([key, value]) => Reflect.get(context.overviewFilters ?? {}, key) === value
							)
						)
							return
						if (context.route && context.forms && context.ledgerPage !== 1)
							enq.sendTo(context.forms.owner, {
								type: 'NAVIGATE',
								replace: true,
								destination: withQueryParams(
									`${context.route.pathname}${context.route.search}${context.route.hash}`,
									{ page: null }
								)
							})
						return { context: { overviewFilters: event.filters, ledgerPage: 1 } }
					},
					SET_ACCOUNT_DELETE_GRANT: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'SET_ACCOUNT_DELETE_GRANT',
							accountId: event.accountId,
							userId: event.userId,
							canDelete: event.canDelete
						})
					},
					START_BACKUP: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						) {
							enq(() => event.submission.release())
							return {}
						}
						enq.sendTo(context.forms.owner, { type: 'START_BACKUP', submission: event.submission })
					},
					START_WORKSPACE_RESTORE: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						) {
							enq(() => event.request.release())
							return {}
						}
						enq.sendTo(context.forms.owner, {
							type: 'START_WORKSPACE_RESTORE',
							request: event.request
						})
					},
					BACKUP_COMMAND: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'BACKUP_COMMAND', command: event.command })
					},
					WORKSPACE_RESTORE_COMMAND: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'WORKSPACE_RESTORE_COMMAND',
							command: event.command
						})
					},
					WORKSPACE_CREATION: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'WORKSPACE_CREATION', command: event.command })
					},
					PROFILE: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'PROFILE',
							form: event.form,
							command: event.command
						})
					},
					WORKSPACE_SETTINGS: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'WORKSPACE_SETTINGS', command: event.command })
					},
					CLASSIFICATION: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, {
							type: 'CLASSIFICATION',
							form: event.form,
							command: event.command
						})
					},
					ACCOUNT_ORDER: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'ACCOUNT_ORDER', command: event.command })
					},
					ACCOUNT_CREATION: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'ACCOUNT_CREATION', command: event.command })
					},
					ADD_SAMPLES: ({ context, event }, enq) => {
						if (debugEnabled && sameCommandScope(context, event) && context.forms)
							enq.sendTo(context.forms.owner, { type: 'ADD_SAMPLES', kind: event.kind })
					},
					RETRY_INITIALIZATION: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							!context.formsView?.canRetryInitialization
						)
							return
						enq.sendTo(context.forms.owner, { type: 'SHUTDOWN' })
						return { target: '#finance-worker.retiringForms', context: { formsView: undefined } }
					},
					RETRY_INTEGRITY: ({ context, event }, enq) => {
						if (sameCommandScope(context, event) && context.forms)
							enq.sendTo(context.forms.owner, { type: 'RETRY_INTEGRITY' })
					},
					DISMISS_MUTATION_NOTICE: ({ context, event }, enq) => {
						if (sameCommandScope(context, event) && context.forms)
							enq.sendTo(context.forms.owner, { type: 'DISMISS_MUTATION_NOTICE' })
					},
					BANK_HISTORY: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'BANK_HISTORY', command: event.command })
					},
					BANK: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'BANK', event: event.command })
					},
					TRANSACTION_IMAGE: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'TRANSACTION_IMAGE', command: event.command })
					},
					TRANSFER_EDIT: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'TRANSFER_EDIT', command: event.command })
					},
					TRANSFER_ENTRY: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'TRANSFER_ENTRY', command: event.command })
					},
					TRANSACTION_EDIT: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'TRANSACTION_EDIT', command: event.command })
					},
					TRANSACTION_ENTRY: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'TRANSACTION_ENTRY', command: event.command })
					},
					ARCHIVE_ACCOUNT: ({ context, event }, enq) => {
						if (
							!sameCommandScope(context, event) ||
							!context.forms ||
							context.forms.binding !== context.ready?.binding
						)
							return
						enq.sendTo(context.forms.owner, { type: 'ARCHIVE_ACCOUNT', accountId: event.accountId })
					}
				},
				states: {
					waiting: {},
					ready: {
						entry: ({ context, self }, enq) => {
							if (!context.ready || context.forms) return
							const binding = context.ready.binding
							const owner = enq.spawn(
								context.ready.capabilities.createForms(
									observeForms,
									context.ready.capabilities.archiveAccount,
									context.navigate,
									context.accountOrderStorage,
									(event) => self.send(event),
									context.route !== undefined
								),
								{
									id: 'forms',
									input: {
										observation: formsObservation(context),
										offline: context.offline,
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
					readFailed: {
						on: {
							RETRY_WORKSPACE_NAVIGATION: ({ context, event }) =>
								sameCommandScope(context, event) && context.route && context.ready
									? {
											target: 'ready',
											context: { facts: undefined, readBinding: {}, formsView: undefined }
										}
									: undefined
						}
					}
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
					RECOVERY_VALIDATED: {},
					RECOVERY_DRAIN_REQUESTED: {},
					RESTORATION_FINISHED: ({ context, event, value }) => {
						if (!sameRestoration(context, event.scope)) return
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
									type: 'WORKSPACE_DRAINED'
								})
						}
					},
					resuming: {
						type: 'choice',
						choice: ({ context }) => {
							const settled = required(context.settledRestoration),
								view = settled.view
							const ready =
								view.stage === 'active' &&
								settled.result.outcome !== 'restorationChildFailed' &&
								view.observation?.status === 'ready'
									? view.observation
									: undefined
							return {
								target:
									view.stage === 'active' && settled.result.outcome !== 'restorationChildFailed'
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
									recoveryNavigation:
										settled.result.outcome === 'navigationFailed'
											? settled.result.navigation
											: undefined,
									selection: { workspaceId: null, revision: context.selection.revision },
									transactionId: null,
									ledgerPage: 1,
									ledgerFilters: emptyLedgerFilters,
									selectedAccountIds: null
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
								selectedAccountIds:
									ready && ready.binding !== context.ready?.binding
										? null
										: context.selectedAccountIds,
								...(ready && ready.binding !== context.ready?.binding
									? transactionContextForRoute(context.route)
									: {}),
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
										selectedAccountIds:
											event.selection.workspaceId === context.selection.workspaceId
												? context.selectedAccountIds
												: null,
										transactionKind: event.kind,
										transactionId: event.transactionId ?? null,
										formsView: undefined
									}
								}
							: undefined
				}
			},
			draining: {
				type: 'parallel',
				on: { CLOSE: {}, NATIVE_FAILED: {}, FORMS_VIEW: {} },
				onDone: { target: 'closingSession' },
				states: {
					financial: {
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
					},
					recovery: {
						initial: 'assessing',
						states: {
							assessing: {
								type: 'choice',
								choice: ({ context }) => ({ target: context.restoration ? 'waiting' : 'closed' })
							},
							waiting: {
								on: {
									RESTORATION_FINISHED: ({ context, event }) =>
										sameRestoration(context, event.scope)
											? { target: 'closed', context: { restoration: undefined } }
											: undefined,
									RESTORATION_FAILED: ({ context, event }) =>
										sameRestoration(context, event)
											? { target: 'closed', context: { restoration: undefined } }
											: undefined
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
			failed: {
				on: {
					RETRY_SESSION: ({ context }, enq) => {
						if (context.forms || context.restoration) return
						enq.sendTo(context.session.owner, { type: 'RETRY' })
						return { target: 'running.waiting' }
					}
				}
			},
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
	const group =
		snapshot.status === 'active' &&
		context.forms?.binding === context.ready?.binding &&
		context.formsView?.selectionRevision === context.selection.revision
			? context.formsView
			: undefined
	const orderedAccounts = orderAccounts(
		context.facts?.accounts?.filter((account) => !account.archivedAt) ?? [],
		group?.order?.view.ids ?? []
	)
	const transactionAccounts = writableTransactionAccounts({
		...transactionFacts,
		accounts: orderedAccounts
	})
	const forms = group?.status === 'ready' ? group : undefined
	const navigation = status === 'failed' ? 'failed' : (group?.navigation?.status ?? 'waiting')
	const navigationNotice =
		navigation === 'waiting' || navigation === 'unavailable' || navigation === 'failed'

	const archive = forms?.archive
	const archiveRows = new Map(archive?.view.rows.map((row) => [row.account.id, row]) ?? [])

	return {
		type: 'VIEW',
		sessionRevision: context.sessionRevision,
		transactionKind: context.transactionKind,
		transactionId: context.transactionId,
		selection: context.selection,
		status,
		identityRestore: {
			canSubmit: selectFinanceRestorationAdmission(snapshot, context.sessionRevision) !== undefined,
			busy: context.restoration !== undefined,
			navigationOnly: context.restoration?.operation === 'navigate',
			navigationError: context.restorationOutcome === 'navigationFailed',
			canRetryNavigation:
				selectFinanceNavigationRetry(snapshot, context.sessionRevision) !== undefined,
			error:
				context.restorationOutcome === 'invalid' ||
				context.restorationOutcome === 'restoreFailed' ||
				context.restorationOutcome === 'restorationChildFailed',
			draftRevision: context.restorationAttempt
		},
		workspaceNavigation: context.route
			? {
					status: navigation,
					showContent: !navigationNotice,
					notice: {
						active: navigationNotice,
						loading: navigation === 'waiting',
						failed: navigation === 'failed'
					},
					canRetry:
						snapshot.matches('running') &&
						!!context.ready &&
						(navigation === 'failed' || navigation === 'unavailable')
				}
			: null,
		recoveryAvailable:
			snapshot.status === 'active' &&
			snapshot.matches('running') &&
			context.ready?.identityKind === 'device',
		selectedAccountIds: snapshot.status === 'active' ? context.selectedAccountIds : null,
		identityId: snapshot.status === 'active' ? (context.ready?.identityId ?? null) : null,
		workspaces: snapshot.status === 'active' ? (context.facts?.workspaces ?? null) : null,
		accounts:
			snapshot.status === 'active'
				? orderedAccounts.map(({ id, name, kind, currency }) => ({
						id,
						name,
						kind,
						currency,
						balanceMinor: balances?.get(id) ?? null,
						archiveAction:
							archive && archive.binding === context.readBinding
								? (archiveRows.get(id)?.action ?? 'unavailable')
								: 'unavailable'
					}))
				: [],
		archiveFeedback:
			snapshot.status === 'active' && archive && archive.binding === context.readBinding
				? projectAccountArchiveFeedback(archive.view.feedback)
				: null,
		workspaceStartup: forms?.initialization ?? null,
		accountCreation: forms?.creation ?? null,
		accountArchive: archive
			? {
					kind: archive.view.kind,
					rows: orderedAccounts.map((account) => ({
						account,
						action: archiveRows.get(account.id)?.action ?? 'unavailable'
					})),
					feedback: projectAccountArchiveFeedback(archive.view.feedback)
				}
			: null,
		accountAccess: group?.accountAccess ?? null,
		overview: selectWorkerOverview(
			context.facts,
			context.overviewFilters,
			context.ledgerPage,
			context.selectedAccountIds
		),
		workspaceCreation: group?.workspaceCreation ?? null,
		backup: group?.backup ?? null,
		workspaceRestore: group?.workspaceRestore ?? null,
		profile: group?.profile ? { row: context.facts?.profile ?? null, forms: group.profile } : null,
		workspace: group?.workspace
			? { row: context.facts?.workspace ?? null, form: group.workspace }
			: null,
		classification:
			group?.classification && observations.classification.binding
				? {
						forms: group.classification,
						countsLoading: context.facts?.transactions == null,
						categories: [...observations.classification.categories],
						tags: [...observations.classification.tags],
						categoryOptions: observations.classification.categories.filter((c) => !c.archivedAt),
						counts: [
							...classificationCounts(
								observations.classification.categories,
								context.facts?.transactions ?? [],
								observations.classification.tags
							)
						],
						archivableCategoryIds: selectManagementArchiveIds(
							observations.classification,
							observations.classification.binding,
							'archiveCategory'
						),
						archivableTagIds: selectManagementArchiveIds(
							observations.classification,
							observations.classification.binding,
							'archiveTag'
						)
					}
				: null,
		accountOrder: group?.order
			? {
					ids: [...group.order.view.ids],
					editing: group.order.view.editing,
					canToggle: group.order.view.canToggle,
					moves: group.order.view.moves
				}
			: null,
		ledger:
			snapshot.status === 'active'
				? selectWorkerLedger(
						context.facts,
						context.transactionKind,
						context.ledgerFilters,
						context.ledgerPage,
						context.selectedAccountIds
					)
				: null,
		transfers:
			snapshot.status === 'active'
				? selectWorkerTransfers(
						context.facts,
						context.ledgerPage,
						context.selectedAccountIds,
						context.route ? transferIdForPath(context.route.pathname) : null
					)
				: null,
		samples: group?.samples ?? null,
		canRetrySession: snapshot.matches('failed') && !context.forms && !context.restoration,
		canRetryInitialization: group?.canRetryInitialization ?? false,
		workspaceIntegrity: group?.integrity ?? null,
		mutationRejected: group?.mutationRejected ?? false,
		bank: group?.bank ?? null,
		transactionDetails: group?.transactionDetails ?? null,
		transferEdit: group?.transferEdit ?? null,
		transferCreation: group?.transferCreation
			? {
					form: group.transferCreation,
					accounts: selectInternalTransferEntryAccounts(observations.transferCreate).map(
						({ id, name, kind, currency }) => workerAccount.parse({ id, name, kind, currency })
					)
				}
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
									...(edited.account?.name ? { accountName: edited.account.name } : {}),
									...(edited.category?.name ? { categoryName: edited.category.name } : {}),
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
													checkDate: edited.check.checkDate ?? ''
												}
											}
										: {}),
									tags: edited.tags?.flatMap((link) => (link.tag ? [link.tag.name] : [])) ?? []
								}
							: null
					}
				: null,
		transactionEntry:
			forms && group?.order
				? {
						kind: context.transactionKind,
						form: forms.transaction,
						accounts: transactionAccounts,
						categories: applicableTransactionCategories(transactionFacts),
						tagSuggestions: applicableTransactionTags(transactionFacts).map((tag) => tag.name),
						defaultAccountId:
							transactionAccounts.find(
								(account) =>
									context.selectedAccountIds === null ||
									context.selectedAccountIds.includes(account.id)
							)?.id ?? null,
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
		sampleSelectedAccounts: null,
		bank: {
			organizationId: null,
			userId: undefined,
			sessionReady: false,
			membership: undefined,
			connections: [],
			accounts: [],
			links: []
		},
		transferCreate: { ...archive, categories: [] },
		transfers: { rows: [], transactions: [], loading: true, failed: false },
		accountAccess: { ...archive, members: [], grants: [] },
		backup: {
			identityId: null,
			workspaceId: null,
			membershipId: null,
			memberUserId: null,
			ownerId: null,
			role: null,
			access: null,
			sessionReady: false,
			attached: false,
			loading: true,
			failed: false
		},
		profile: {
			identityId: null,
			binding: null,
			sessionReady: false,
			loading: true,
			failed: false,
			profile: undefined
		},
		workspace: {
			identityId: null,
			organizationId: null,
			binding: null,
			sessionReady: false,
			workspaceLoading: true,
			membershipLoading: true,
			workspaceError: false,
			membershipError: false,
			workspace: undefined,
			membership: undefined
		},
		order: { key: null, ids: [] },
		classification: { ...archive, categories: [], tags: [] },
		navigation: {
			pathname: '/',
			search: '',
			hash: '',
			generation: 0,
			userId: undefined,
			ready: false,
			loading: true,
			error: undefined,
			organizations: [],
			access: 'waiting'
		},
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

export function selectFinanceNavigationRetry(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined,
	revision: number
) {
	const admitted = selectFinanceRestorationAdmission(snapshot, revision),
		navigation = snapshot?.context.recoveryNavigation
	return admitted &&
		navigation &&
		snapshot?.context.href === navigation.origin &&
		snapshot.context.ready?.identityId === navigation.identity
		? { ...admitted, navigation }
		: undefined
}

/** Private-file/secret admission. Preparation stays outside inspected events; charts own the operation. */
export function selectFinanceBackupAdmission(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined,
	scope: WorkerCommandScope
) {
	if (
		!snapshot?.matches('running') ||
		!sameCommandScope(snapshot.context, scope) ||
		!snapshot.context.ready ||
		snapshot.context.forms?.binding !== snapshot.context.ready.binding
	)
		return undefined
	return snapshot.context.ready.capabilities
}

/** Private bank input admission; tokens never become ordinary Root events. */
export function selectFinanceBankAdmission(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceWorkerMachine>> | undefined,
	scope: WorkerCommandScope
) {
	return snapshot?.status === 'active' &&
		snapshot.matches('running') &&
		sameCommandScope(snapshot.context, scope) &&
		snapshot.context.forms?.binding === snapshot.context.ready?.binding
		? snapshot.context.forms?.owner
		: undefined
}
