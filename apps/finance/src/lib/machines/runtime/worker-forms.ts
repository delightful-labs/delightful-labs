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
import { setup, types, matchesState, type SnapshotFrom } from 'xstate'
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
	selectFinanceFinancialReport,
	type FinancialControlsView
} from './worker-financial-controls.js'
export function createFinanceFormGroups(dependencies: FinanceFormsDependencies) {
	return {
		identity: createFinanceIdentityControlsMachine(dependencies),
		financial: createFinanceFinancialControlsMachine(dependencies)
	}
}
export function createFinanceFormsMachine(dependencies: FinanceFormsDependencies) {
	const groups = createFinanceFormGroups(dependencies)
	type Input = { observation: FinanceFormsObservation; selectionRevision: number; offline: boolean }
	type Context = Input & {
		identity: ReturnType<typeof selectFinanceIdentityControls> | undefined
		financial: ReturnType<typeof selectFinanceFinancialReport> | undefined
	}
	return setup({
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
			internalEvents: { IDENTITY_CLOSED: types(), FINANCIAL_CLOSED: types() },
			children: {
				identity: types<import('xstate').ActorRefFrom<typeof groups.identity>>(),
				financial: types<import('xstate').ActorRefFrom<typeof groups.financial>>()
			}
		},
		actors: groups
	}).createMachine({
		id: 'finance-forms',
		initial: 'active',
		context: ({ input }) => ({ ...input, identity: undefined, financial: undefined }),
		output: () => ({ outcome: 'closed' }),
		on: {
			BANK_NETWORK: ({ event }) => ({ context: { offline: event.offline } }),
			CANCEL_TRANSFER_MUTATION: ({ event }, enq) => enq.sendTo('financial', event),
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
						enq.sendTo('financial', {
							type: 'INITIALIZATION_OBSERVED',
							initialization: identity.initialization
						})
					return { context: { identity } }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'IDENTITY_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'financial',
				src: 'financial',
				input: ({ context }) => ({ ...context, initialization: undefined }),
				onSnapshot: ({ event }) => {
					if (event.snapshot.status === 'done') return
					const financial = selectFinanceFinancialReport(event.snapshot)
					return financial.view.status === 'failed'
						? { target: '.failed', context: { financial } }
						: { context: { financial } }
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
					ADD_SAMPLES: ({ event }, enq) => enq.sendTo('financial', event),
					INTEGRITY_STATUS: ({ event }, enq) => enq.sendTo('financial', event),
					RETRY_INTEGRITY: ({ event }, enq) => enq.sendTo('financial', event),
					DISMISS_MUTATION_NOTICE: ({ event }, enq) => enq.sendTo('financial', event),
					BANK_HISTORY: ({ event }, enq) => enq.sendTo('financial', event),
					BANK: ({ event }, enq) => enq.sendTo('financial', event),
					BANK_NETWORK: ({ event }, enq) => enq.sendTo('financial', event),
					TRANSACTION_IMAGE: ({ event }, enq) => enq.sendTo('financial', event),
					TRANSFER_MUTATION_REQUEST: ({ event }, enq) => enq.sendTo('financial', event),
					CANCEL_TRANSFER_MUTATION: ({ event }, enq) => enq.sendTo('financial', event),
					TRANSFER_ENTRY: ({ event }, enq) => enq.sendTo('financial', event),
					TRANSFER_EDIT: ({ event }, enq) => enq.sendTo('financial', event),
					SET_ACCOUNT_DELETE_GRANT: ({ event }, enq) => enq.sendTo('financial', event),
					START_BACKUP: ({ event }, enq) => enq.sendTo('financial', event),
					START_WORKSPACE_RESTORE: ({ event }, enq) => enq.sendTo('financial', event),
					BACKUP_COMMAND: ({ event }, enq) => enq.sendTo('financial', event),
					WORKSPACE_RESTORE_COMMAND: ({ event }, enq) => enq.sendTo('financial', event),
					WORKSPACE_CREATION: ({ event }, enq) => enq.sendTo('identity', event),
					PROFILE: ({ event }, enq) => enq.sendTo('identity', event),
					WORKSPACE_SETTINGS: ({ event }, enq) => enq.sendTo('financial', event),
					CLASSIFICATION: ({ event }, enq) => enq.sendTo('financial', event),
					SELECT_WORKSPACE: ({ event }, enq) => enq.sendTo('identity', event),
					NAVIGATE: ({ event }, enq) => enq.sendTo('identity', event),
					RETRY_NAVIGATION: ({ event }, enq) => enq.sendTo('identity', event),
					ARCHIVE_ACCOUNT: ({ event }, enq) => enq.sendTo('financial', event),
					ACCOUNT_ORDER: ({ event }, enq) => enq.sendTo('financial', event),
					ACCOUNT_CREATION: ({ event }, enq) => enq.sendTo('financial', event),
					TRANSACTION_ENTRY: ({ event }, enq) => enq.sendTo('financial', event),
					TRANSACTION_EDIT: ({ event }, enq) => enq.sendTo('financial', event),
					OBSERVE: ({ event }, enq) => {
						enq.sendTo('identity', event)
						enq.sendTo('financial', event)
						return {
							context: {
								observation: event.observation,
								selectionRevision: event.selectionRevision
							}
						}
					},
					SHUTDOWN: (_, enq) => {
						enq.sendTo('identity', { type: 'SHUTDOWN' })
						enq.sendTo('financial', { type: 'SHUTDOWN' })
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
	const currentFinancial = c.financial?.observation === c.observation ? c.financial.view : undefined
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
