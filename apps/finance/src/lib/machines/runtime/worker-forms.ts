import { workerSamplesView } from '../../contracts/worker-forms.js'
import {
	selectWorkspaceIntegrityView,
	type IntegrityReport
} from '../../contracts/workspace-integrity-contract.js'
import type { WorkerBankHistoryCommand } from '../../contracts/worker-banks.js'
import type { BankEvent } from '../bank-sync/types.js'
import { workerBankView } from '../../contracts/worker-banks.js'
import { selectWorkerTransactionDetails } from '../transactions/worker-transaction-details.js'
import {
	workerSavedImageView,
	type WorkerTransactionImageCommand
} from '../../contracts/worker-images.js'
import {
	rejectedTransferMutation,
	type TransferMutationRequest
} from '../transfers/internal-transfer-mutation-owner.js'
import { type WorkerTransferCreationView } from '../../contracts/worker-forms.js'
import {
	type WorkerTransferEditView,
	type WorkerTransferEditCommand
} from '../../contracts/worker-transfers.js'
import { type WorkerAccountAccessView } from '../../contracts/worker-accounts.js'
import {
	type WorkspaceRestoreFile,
	type WorkspaceRestoreCommand
} from '../workspaces/workspace-restore.js'
import { workerBackupView, workerWorkspaceRestoreView } from '../../contracts/worker-backup.js'
import type { BackupSubmission } from '../../backup/submission.js'
import {
	workerWorkspaceCreationView,
	type WorkerWorkspaceCreationView,
	type workerWorkspaceCreationCommand
} from '../../contracts/worker-forms.js'
import type { z } from 'zod'
import {
	workerProfileForms,
	type WorkerProfileForms,
	type WorkerWorkspaceFormView
} from '../../contracts/worker-forms.js'
import type { ClassificationForm, WorkerClassificationForms } from '../../contracts/worker-forms.js'
import { selectPersistedAccountOrder } from '../accounts/account-order-persistence.js'
import type { WorkerAccountOrderCommand } from '../../contracts/worker-forms.js'
import type { NavigationReport } from '../../contracts/workspace-orchestration-contract.js'
import { selectAccountArchiveReport } from '../accounts/account-archive.js'
import {
	setup,
	types,
	matchesState,
	type SnapshotFrom,
	type InputFrom,
	type EventFromLogic,
	type SendableEventFromLogic
} from 'xstate'
import type { TransactionEntryObservation } from '../../contracts/transaction-entry-contract.js'
import {
	type WorkerFormCommand,
	type WorkerTransactionEntryView,
	type WorkerAccountCreationView,
	type FinanceFormsObservation
} from '../../contracts/worker-forms.js'
import {
	createFinanceIdentityControlsMachine,
	selectFinanceIdentityControls
} from './worker-identity-controls.js'

export type { FinanceFormsDependencies } from './worker-form-dependencies.js'
import type { FinanceFormsDependencies } from './worker-form-dependencies.js'
import {
	createFinanceFinancialControlsMachine,
	type FinancialControlsView
} from './worker-financial-controls.js'
export function createFinanceFormGroups(dependencies: FinanceFormsDependencies) {
	return {
		identity: createFinanceIdentityControlsMachine(dependencies),
		financial: createFinanceFinancialControlsMachine(dependencies)
	}
}
import { createWorkspaceResourceOwner } from 'delightful-local-first/workspace/resource'
import type {
	WorkspaceSelectionScope,
	WorkspaceSelectionRequest,
	WorkspaceSelectionObservation
} from 'delightful-local-first/workspace/contracts'
import {
	createFinanceWorkspaceResources,
	selectFinanceWorkspaceResources,
	refuseFinanceFinancialCommand,
	type FinanceReadScope,
	type FinanceResourceObservation
} from './worker-workspace-resources.js'
import { financeWorkspaceAccess, type WorkspaceAccessFacts } from './worker-workspace-access.js'

function sameRequest(
	left: WorkspaceSelectionRequest | undefined,
	right: WorkspaceSelectionRequest | undefined
) {
	return (
		!!left && !!right && left.workspaceId === right.workspaceId && left.attempt === right.attempt
	)
}
export function createFinanceFormsMachine(dependencies: FinanceFormsDependencies) {
	const groups = createFinanceFormGroups(dependencies)
	const resource = createFinanceWorkspaceResources({
		financial: groups.financial,
		capabilities: dependencies.content,
		reportDisposalFailure: dependencies.reportDisposalFailure
	})
	const workspace = createWorkspaceResourceOwner<
		undefined,
		InputFrom<typeof resource>,
		EventFromLogic<typeof resource>,
		SnapshotFrom<typeof resource>,
		ReturnType<typeof selectFinanceWorkspaceResources>,
		SendableEventFromLogic<typeof resource>
	>({
		resource,
		input: (lease) => ({ lease }),
		shutdown: { type: 'SHUTDOWN' },
		view: selectFinanceWorkspaceResources,
		failed: (snapshot) => selectFinanceWorkspaceResources(snapshot).failed,
		settlement: (output) => (output?.outcome === 'released' ? 'released' : 'unresolved'),
		refused: (command) => {
			if (command.type === 'FINANCIAL') refuseFinanceFinancialCommand(command.command)
		}
	})
	type Input = {
		observation: FinanceFormsObservation
		selectionRevision: number
		offline: boolean
		read: FinanceReadScope
		access: WorkspaceAccessFacts | undefined
	}
	type Context = Input & {
		sent:
			| {
					lease: import('delightful-local-first/workspace/contracts').WorkspaceLease
					observation: FinanceResourceObservation
			  }
			| undefined
		identity: ReturnType<typeof selectFinanceIdentityControls> | undefined
		resource: ReturnType<typeof workspace.selectReport> | undefined
		scope: WorkspaceSelectionScope
		request: WorkspaceSelectionRequest | undefined
		attempt: number
		generation: number
	}
	const model = setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			events: {
				ADD_SAMPLES: types<{ kind: TransactionEntryObservation['kind'] }>(),
				INTEGRITY_STATUS: types<{ report: IntegrityReport }>(),
				RETRY_INTEGRITY: types(),
				DISMISS_MUTATION_NOTICE: types(),
				BANK_HISTORY: types<{ command: WorkerBankHistoryCommand }>(),
				BANK: types<{ event: BankEvent }>(),
				BANK_NETWORK: types<{ offline: boolean }>(),
				TRANSACTION_IMAGE: types<{ command: WorkerTransactionImageCommand }>(),
				TRANSFER_MUTATION_REQUEST: types<{ request: TransferMutationRequest }>(),
				CANCEL_TRANSFER_MUTATION: types<{ requestId: string }>(),
				TRANSFER_ENTRY: types<{ command: WorkerFormCommand }>(),
				TRANSFER_EDIT: types<{ command: WorkerTransferEditCommand }>(),
				SET_ACCOUNT_DELETE_GRANT: types<{
					accountId: string
					userId: string
					canDelete: boolean
				}>(),
				START_BACKUP: types<{ submission: BackupSubmission }>(),
				START_WORKSPACE_RESTORE: types<{ request: WorkspaceRestoreFile }>(),
				BACKUP_COMMAND: types<{ command: 'CANCEL' | 'RELOAD' }>(),
				WORKSPACE_RESTORE_COMMAND: types<{ command: WorkspaceRestoreCommand['type'] }>(),
				WORKSPACE_CREATION: types<{ command: z.output<typeof workerWorkspaceCreationCommand> }>(),
				PROFILE: types<{ form: 'name' | 'avatar'; command: WorkerFormCommand }>(),
				WORKSPACE_SETTINGS: types<{ command: WorkerFormCommand }>(),
				CLASSIFICATION: types<{
					form: ClassificationForm
					command: WorkerFormCommand
				}>(),
				OBSERVE: types<Omit<Input, 'offline'>>(),
				SELECT_WORKSPACE: types<{ workspaceId: string }>(),
				NAVIGATE: types<{ destination: string; replace: boolean }>(),
				RETRY_NAVIGATION: types(),
				ARCHIVE_ACCOUNT: types<{ accountId: string }>(),
				ACCOUNT_ORDER: types<{ command: WorkerAccountOrderCommand }>(),
				ACCOUNT_CREATION: types<{ command: WorkerFormCommand }>(),
				TRANSACTION_ENTRY: types<{ command: WorkerFormCommand }>(),
				TRANSACTION_EDIT: types<{ command: WorkerFormCommand }>(),
				SHUTDOWN: types()
			},
			internalEvents: {
				IDENTITY_CLOSED: types(),
				FINANCIAL_CLOSED: types(),
				SYNC_SELECTION: types(),
				SYNC_RESOURCE: types()
			},
			children: {
				identity: types<import('xstate').ActorRefFrom<typeof groups.identity>>(),
				workspace: types<import('xstate').ActorRefFrom<typeof workspace.logic>>()
			}
		},
		actors: { identity: groups.identity, workspace: workspace.logic }
	})
	type FinancialCommand = Exclude<
		SendableEventFromLogic<typeof groups.financial>,
		{ type: 'SHUTDOWN' | 'OBSERVE' }
	>
	type Entry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type Queue = Parameters<Entry>[1]
	const forwardFinancial = (
		{ context, event }: { context: Context; event: FinancialCommand },
		enq: Queue
	) => {
		if (context.resource?.status !== 'active') {
			enq(refuseFinanceFinancialCommand, event)
			return
		}
		enq.sendTo('workspace', {
			type: 'RESOURCE_COMMAND',
			lease: context.resource.lease,
			command: { type: 'FINANCIAL', command: event }
		})
	}

	return model.createMachine({
		id: 'finance-forms',
		initial: 'active',
		context: ({ input }) => ({
			...input,
			sent: undefined,
			identity: undefined,
			resource: undefined,
			scope: { binding: dependencies.binding, attachment: {} },
			request: undefined,
			attempt: 0,
			generation: 0
		}),
		entry: (_, enq) => enq.raise({ type: 'SYNC_SELECTION' }),
		output: () => ({ outcome: 'closed' }),
		on: {
			BANK_NETWORK: ({ event }) => ({ context: { offline: event.offline } }),
			START_BACKUP: ({ event }, enq) => enq(() => event.submission.release()),
			START_WORKSPACE_RESTORE: ({ event }, enq) => enq(() => event.request.release()),
			TRANSFER_MUTATION_REQUEST: ({ event }, enq) =>
				enq(() =>
					event.request.recipient.send({
						type: 'TRANSFER_MUTATION_RESULT',
						requestId: event.request.requestId,
						result: rejectedTransferMutation(event.request)
					})
				)
		},
		invoke: [
			{
				id: 'identity',
				src: 'identity',
				input: ({ context }) => ({
					observation: context.observation,
					selectionRevision: context.selectionRevision
				}),
				onSnapshot: ({ context, event, value }, enq) => {
					const identity = selectFinanceIdentityControls(event.snapshot)
					if (identity.status === 'failed') return { target: '.failed', context: { identity } }
					if (
						identity.initialization !== context.identity?.initialization &&
						matchesState('active', value)
					)
						enq.raise({ type: 'SYNC_RESOURCE' })
					return { context: { identity } }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'IDENTITY_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'workspace',
				src: 'workspace',
				input: ({ context }) => ({ scope: context.scope, binding: undefined }),
				onSnapshot: ({ context, event, value }, enq) => {
					if (event.snapshot.status === 'done') return
					const resource = workspace.selectReport(event.snapshot)
					if (resource.status === 'unresolved') return { target: '.failed', context: { resource } }
					if (matchesState('active', value) && resource.status === 'active') {
						if (
							resource.view?.content &&
							resource.view.content !==
								(context.resource?.status === 'active' ? context.resource.view?.content : undefined)
						)
							enq(dependencies.contentObserved, resource.lease, resource.view.content)
						enq.raise({ type: 'SYNC_RESOURCE' })
					}
					return { context: { resource } }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'FINANCIAL_CLOSED' })
				},
				onError: { target: '.failed' }
			}
		],
		states: {
			active: {
				on: {
					ADD_SAMPLES: forwardFinancial,
					INTEGRITY_STATUS: forwardFinancial,
					RETRY_INTEGRITY: forwardFinancial,
					DISMISS_MUTATION_NOTICE: forwardFinancial,
					BANK_HISTORY: forwardFinancial,
					BANK: forwardFinancial,
					BANK_NETWORK: ({ event }, enq) => {
						enq.raise({ type: 'SYNC_RESOURCE' })
						return { context: { offline: event.offline } }
					},
					TRANSACTION_IMAGE: forwardFinancial,
					TRANSFER_MUTATION_REQUEST: forwardFinancial,
					CANCEL_TRANSFER_MUTATION: forwardFinancial,
					TRANSFER_ENTRY: forwardFinancial,
					TRANSFER_EDIT: forwardFinancial,
					SET_ACCOUNT_DELETE_GRANT: forwardFinancial,
					START_BACKUP: forwardFinancial,
					START_WORKSPACE_RESTORE: forwardFinancial,
					BACKUP_COMMAND: forwardFinancial,
					WORKSPACE_RESTORE_COMMAND: forwardFinancial,
					WORKSPACE_CREATION: ({ event }, enq) => enq.sendTo('identity', event),
					PROFILE: ({ event }, enq) => enq.sendTo('identity', event),
					WORKSPACE_SETTINGS: forwardFinancial,
					CLASSIFICATION: forwardFinancial,
					SELECT_WORKSPACE: ({ event }, enq) => enq.sendTo('identity', event),
					NAVIGATE: ({ event }, enq) => enq.sendTo('identity', event),
					RETRY_NAVIGATION: ({ event }, enq) => enq.sendTo('identity', event),
					ARCHIVE_ACCOUNT: forwardFinancial,
					ACCOUNT_ORDER: forwardFinancial,
					ACCOUNT_CREATION: forwardFinancial,
					TRANSACTION_ENTRY: forwardFinancial,
					TRANSACTION_EDIT: forwardFinancial,
					OBSERVE: ({ event }, enq) => {
						enq.sendTo('identity', {
							type: 'OBSERVE',
							observation: event.observation,
							selectionRevision: event.selectionRevision
						})
						enq.raise({ type: 'SYNC_SELECTION' })
						return {
							context: {
								observation: event.observation,
								selectionRevision: event.selectionRevision,
								read: event.read,
								access: event.access
							}
						}
					},
					SYNC_SELECTION: ({ context }, enq) => {
						const workspaceId = context.read.selection.workspaceId
						if (!workspaceId) {
							enq.sendTo('workspace', { type: 'SUSPEND', scope: context.scope })
							return { context: { request: undefined } }
						}
						const changed = context.request?.workspaceId !== workspaceId
						const request = changed
							? { workspaceId, attempt: context.attempt + 1 }
							: context.request
						if (!request) return
						const generation = context.generation + 1
						const observation: WorkspaceSelectionObservation = {
							scope: context.scope,
							request,
							generation,
							directory:
								context.access?.status === 'failed'
									? { status: 'failed' }
									: context.access?.workspaces
										? { status: 'available', entries: context.access.workspaces }
										: { status: 'loading' },
							access: financeWorkspaceAccess(
								context.observation.profile.identityId,
								workspaceId,
								context.access
							)
						}
						if (changed) enq.sendTo('workspace', { type: 'SELECT', scope: context.scope, request })
						if (!context.request) enq.sendTo('workspace', { type: 'RESUME', observation })
						enq.sendTo('workspace', { type: 'OBSERVED', observation })
						enq.raise({ type: 'SYNC_RESOURCE' })
						return {
							context: {
								request,
								attempt: request.attempt,
								generation
							}
						}
					},
					SYNC_RESOURCE: ({ context }, enq) => {
						const resource = context.resource
						if (
							resource?.status !== 'active' ||
							!sameRequest(resource.lease.request, context.request) ||
							financeWorkspaceAccess(
								context.observation.profile.identityId,
								context.read.selection.workspaceId,
								context.access
							) !== 'allowed'
						)
							return
						const previous =
							context.sent?.lease === resource.lease ? context.sent.observation : undefined
						if (
							previous?.forms.observation === context.observation &&
							previous.forms.selectionRevision === context.selectionRevision &&
							previous.forms.offline === context.offline &&
							previous.forms.initialization === context.identity?.initialization &&
							previous.read.binding === context.read.binding
						)
							return
						const observation: FinanceResourceObservation = {
							forms: {
								observation: context.observation,
								selectionRevision: context.selectionRevision,
								offline: context.offline,
								initialization: context.identity?.initialization
							},
							read: context.read
						}
						enq.sendTo('workspace', {
							type: 'RESOURCE_COMMAND',
							lease: resource.lease,
							command: { type: 'OBSERVE', observation }
						})
						return { context: { sent: { lease: resource.lease, observation } } }
					},
					SHUTDOWN: (_, enq) => {
						enq.sendTo('identity', { type: 'SHUTDOWN' })
						enq.sendTo('workspace', { type: 'SHUTDOWN' })
						return { target: 'closing' }
					}
				}
			},
			closing: {
				type: 'parallel',
				on: { SHUTDOWN: {} },
				onDone: { target: 'closed' },
				states: {
					identity: {
						initial: 'waiting',
						states: {
							waiting: { on: { IDENTITY_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					financial: {
						initial: 'waiting',
						states: {
							waiting: { on: { FINANCIAL_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					}
				}
			},
			failed: { on: { SHUTDOWN: {} } },
			closed: { type: 'final' }
		}
	})
}
type FormsView = {
	workspaceLease: import('delightful-local-first/workspace/contracts').WorkspaceLease | undefined
	samples: z.output<typeof workerSamplesView> | null
	canRetryInitialization: boolean
	integrity: ReturnType<typeof selectWorkspaceIntegrityView>
	mutationRejected: boolean
	bank: z.output<typeof workerBankView> | null
	transactionDetails:
		| (NonNullable<ReturnType<typeof selectWorkerTransactionDetails>['view']> & {
				editor: z.output<typeof workerSavedImageView> | null
				removingIds: string[]
				failedIds: string[]
		  })
		| null
	transferCreation: WorkerTransferCreationView | null
	transferEdit: WorkerTransferEditView | null
	accountAccess: WorkerAccountAccessView | null
	backup: z.output<typeof workerBackupView> | null
	workspaceRestore: z.output<typeof workerWorkspaceRestoreView> | null
	workspaceCreation: WorkerWorkspaceCreationView | null
	profile: WorkerProfileForms | null
	workspace: WorkerWorkspaceFormView | null
	classification: WorkerClassificationForms | null
	order: ReturnType<typeof selectPersistedAccountOrder>
	navigation: NavigationReport | undefined
	archive: ReturnType<typeof selectAccountArchiveReport> | undefined
	selectionRevision: number
	initialization: 'checking' | 'ready' | 'unavailable' | 'failed' | 'closed'
} & (
	| { status: 'loading' | 'failed'; creation: null; transaction: null; edit: null }
	| {
			status: 'ready'
			creation: WorkerAccountCreationView
			transaction: WorkerTransactionEntryView
			edit: WorkerTransactionEntryView
	  }
)

export function selectFinanceFormsView(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceFormsMachine>>
): FormsView {
	const c = snapshot.context,
		identity = c.identity
	const report = c.resource?.status === 'active' ? c.resource.view?.financial : undefined
	const currentFinancial =
		report?.observation === c.observation && sameRequest(c.resource?.lease?.request, c.request)
			? report.view
			: undefined
	const financial: FinancialControlsView = currentFinancial ?? {
		samples: null,
		integrity: selectWorkspaceIntegrityView(undefined),
		mutationRejected: false,
		bank: null,
		transactionDetails: null,
		transferCreation: null,
		transferEdit: null,
		accountAccess: null,
		backup: null,
		workspaceRestore: null,
		workspace: null,
		classification: null,
		order: undefined,
		archive: undefined,
		selectionRevision: c.selectionRevision,
		status: 'loading',
		creation: null,
		transaction: null,
		edit: null
	}
	const navigation =
		identity?.navigation?.generation === c.observation.navigation.generation
			? identity.navigation
			: undefined
	const creationReport = identity?.workspaceCreation
	const created = workerWorkspaceCreationView.safeParse(creationReport?.view)
	const workspaceCreation =
		creationReport?.binding?.userId === c.observation.profile.identityId &&
		creationReport?.binding?.profileId === c.observation.profile.profile?.id &&
		created.success
			? created.data
			: null
	const profileView = workerProfileForms.safeParse({
		name: identity?.profileName,
		avatar: identity?.profileAvatar
	})
	const profile =
		identity?.profileNameObservation === c.observation.profile &&
		identity?.profileAvatarObservation === c.observation.profile &&
		profileView.success
			? profileView.data
			: null
	const result = identity?.initialization
	const canRetryInitialization =
		result?.outcome === 'unavailable' ||
		(result?.outcome === 'failed' && result.settlement === 'notStarted')
	const initialization =
		result?.outcome === 'ready'
			? 'ready'
			: result?.outcome === 'failed'
				? 'failed'
				: result?.outcome === 'closed' || result?.outcome === 'cancelled'
					? 'closed'
					: result
						? 'unavailable'
						: 'checking'
	const view = {
		...financial,
		workspaceLease: selectFinanceFormsLease(snapshot),
		workspaceCreation,
		profile,
		navigation,
		canRetryInitialization,
		initialization,
		selectionRevision: c.selectionRevision
	} satisfies FormsView
	if (snapshot.status !== 'active' || snapshot.matches('failed'))
		return { ...view, status: 'failed', creation: null, transaction: null, edit: null }
	if (
		!identity ||
		identity.profileNameObservation !== c.observation.profile ||
		identity.profileAvatarObservation !== c.observation.profile
	)
		return { ...view, status: 'loading', creation: null, transaction: null, edit: null }
	return view
}

/** Native publication admission consumes this public lease, never child implementation paths. */
export function selectFinanceFormsLease(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceFormsMachine>>
) {
	const c = snapshot.context
	return snapshot.status === 'active' &&
		snapshot.matches('active') &&
		c.resource?.status === 'active' &&
		sameRequest(c.resource.lease.request, c.request) &&
		financeWorkspaceAccess(
			c.observation.profile.identityId,
			c.read.selection.workspaceId,
			c.access
		) === 'allowed'
		? c.resource.lease
		: undefined
}
