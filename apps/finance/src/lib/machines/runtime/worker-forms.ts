import { workerWorkspaceSeed } from '../workspaces/workspace-fake-data.js'
import { createWorkerSamples } from '../samples/worker-samples.js'
import { selectSampleTransactionsView } from '../samples/sample-transactions.js'
import { workerSamplesView } from '../../contracts/worker-forms.js'
import { transactionEntryScope } from '../transactions/transaction-entry.js'
import { canWriteAccount } from '../../domain/organization-permissions.js'
import { debugEnabled } from '../../diagnostics/logger.js'
import { createWorkspaceIntegrityOwner } from '../workspaces/workspace-integrity-owner.js'
import {
	sameIntegrityBinding,
	sameIntegrityRequest,
	selectWorkspaceIntegrityView,
	type IntegrityBinding,
	type IntegrityRequest,
	type IntegrityReport
} from '../../contracts/workspace-integrity-contract.js'
import {
	createWorkerBankHistory,
	selectWorkerBankHistoryReport
} from '../bank-sync/worker-history.js'
import type { WorkerBankHistoryCommand } from '../../contracts/worker-banks.js'
import { createBankSyncMachine, selectBankReport } from '../bank-sync/index.js'
import type { BankEvent } from '../bank-sync/types.js'
import { workerBankView, type WorkerBankCommand } from '../../contracts/worker-banks.js'
import { createCallbackLogic } from 'xstate'
import type { Db as JazzDb } from 'jazz-tools'
import {
	createWorkerTransactionDetails,
	selectWorkerTransactionDetails
} from '../transactions/worker-transaction-details.js'
import {
	transactionAttachmentManagerMachine,
	selectTransactionAttachmentRemovalView
} from '../transactions/attachments/transaction-attachment-manager.js'
import {
	createSavedTransactionImageEditor,
	savedImageEditorReport
} from '../transactions/attachments/saved-transaction-image-editor.js'
import { windowImageEditorMachine } from '../../runtime/worker/image-editor.js'
import {
	workerSavedImageView,
	type WorkerTransactionImageCommand
} from '../../contracts/worker-images.js'
import { createWorkerTransferOwner } from '../transfers/worker-transfer-owner.js'
import type {
	TransferMutationGateway,
	TransferMutationRequestInput
} from '../transfers/internal-transfer-mutation-request.js'
import {
	rejectedTransferMutation,
	type TransferMutationRequest
} from '../transfers/internal-transfer-mutation-owner.js'
import { createTransactionEditMachine } from '../transactions/transaction-edit.js'
import { createInternalTransferEntryFormOptions } from '../transfers/internal-transfer-entry.js'
import {
	workerTransferCreationView,
	type WorkerTransferCreationView
} from '../../contracts/worker-forms.js'
import {
	workerTransferEditView,
	type WorkerTransferEditView,
	type WorkerTransferEditCommand
} from '../../contracts/worker-transfers.js'
import { transactionPages, EXPENSE, INCOME } from '../../domain/transaction-kind.js'
import {
	selectAccountDeleteGrantReport,
	type createAccountDeleteGrantMachine
} from '../accounts/account-delete-grants.js'
import {
	workerAccountAccessView,
	type WorkerAccountAccessView
} from '../../contracts/worker-accounts.js'
import {
	selectWorkspaceBackupReport,
	sameBackupObservation,
	type createWorkspaceBackupMachine
} from '../workspaces/workspace-backup.js'
import {
	selectWorkspaceRestoreReport,
	type createWorkspaceRestoreController,
	type WorkspaceRestoreFile,
	type WorkspaceRestoreCommand
} from '../workspaces/workspace-restore.js'
import { workerBackupView, workerWorkspaceRestoreView } from '../../contracts/worker-backup.js'
import type { BackupSubmission } from '../../backup/submission.js'
import {
	createWorkspaceCreationMachine,
	selectWorkspaceCreationReport
} from '../workspaces/workspace-creation.js'
import {
	workerWorkspaceCreationView,
	type WorkerWorkspaceCreationView,
	type workerWorkspaceCreationCommand
} from '../../contracts/worker-forms.js'
import type { z } from 'zod'
import type { createProfileFormOptions } from '../identity/profile.js'
import type { createWorkspaceRenameFormOptions } from '../workspaces/workspace-rename.js'
import type { ProfileObservation } from '../../contracts/profile-contract.js'
import type { WorkspaceRenameObservation } from '../../contracts/workspace-rename-contract.js'
import {
	workerProfileFormView,
	workerProfileForms,
	workerWorkspaceFormView,
	type WorkerProfileForms,
	type WorkerWorkspaceFormView
} from '../../contracts/worker-forms.js'
import { createClassificationOwner } from '../management/classification-forms.js'
import type { ClassificationForm, WorkerClassificationForms } from '../../contracts/worker-forms.js'
import {
	createAccountOrderPersistenceMachine,
	selectPersistedAccountOrder
} from '../accounts/account-order-persistence.js'
import type { AccountOrderStorage } from '../../contracts/worker-forms.js'
import type { WorkerAccountOrderCommand } from '../../contracts/worker-forms.js'
import type { createWorkspaceNavigationMachine } from '../workspaces/workspace-navigation.js'
import type { NavigationReport } from '../../contracts/workspace-orchestration-contract.js'
import {
	createAccountArchiveMachine,
	selectAccountArchiveReport
} from '../accounts/account-archive.js'
import {
	setup,
	types,
	matchesState,
	type SnapshotFrom,
	type InputFrom,
	type OutputFrom
} from 'xstate'
import { workspaceInitialization } from '../workspaces/workspace-initialization.js'
import { createWorkspaceStartupOwner } from 'delightful-local-first/workspace/startup'
import type { WorkspaceInitializationReport } from 'delightful-local-first/workspace/startup-contracts'
import { createAccountCreationFormOptions } from '../accounts/account-creation-access.js'
import {
	createScopedFormMachine,
	selectScopedFormView,
	selectScopedFormObservation
} from '../forms/scoped-form.js'
import {
	createTransactionEntryFormOptions,
	createTransactionEditFormOptions
} from '../transactions/transaction-entry.js'
import type {
	TransactionEntryObservation,
	TransactionEntryView
} from '../../contracts/transaction-entry-contract.js'
import type {
	AccountCreationObservation,
	AccountCreationView
} from '../../contracts/account-creation-contract.js'
import {
	workerAccountCreationView,
	workerTransactionEntryView,
	type WorkerFormCommand,
	type WorkerTransactionEntryView,
	type WorkerAccountCreationView,
	type FinanceFormsObservation
} from '../../contracts/worker-forms.js'

type InitializationResult = OutputFrom<typeof workspaceInitialization>
const workspaceStartup = createWorkspaceStartupOwner<
	InputFrom<typeof workspaceInitialization>,
	InitializationResult,
	SnapshotFrom<typeof workspaceInitialization>
>({
	initialize: workspaceInitialization,
	provenance: (result) =>
		result.outcome === 'ready'
			? { identityId: result.identityId, initialWorkspaceId: result.workspaceId }
			: undefined
})

/** One SDK-bound workflow owner. Local First owns startup; Finance retains domain policy. */
export function createFinanceFormsMachine(
	dependencies: Omit<Parameters<typeof createAccountCreationFormOptions>[0], 'observe'> & {
		accountOrderStorage: AccountOrderStorage
		transferDispatch: TransferMutationGateway['send']
		creationKey: string
		accountAccess: ReturnType<typeof createAccountDeleteGrantMachine>
		backup: ReturnType<typeof createWorkspaceBackupMachine>
		restore: ReturnType<typeof createWorkspaceRestoreController>
		reload: () => void
		navigate?: Parameters<typeof createTransactionEntryFormOptions>[0]['navigate']
		profile: ReturnType<typeof createProfileFormOptions>
		workspace: ReturnType<typeof createWorkspaceRenameFormOptions<() => Promise<void>>>
		classification: Parameters<typeof createClassificationOwner>[0]
		navigation: ReturnType<typeof createWorkspaceNavigationMachine>
		archive: (accountId: string) => Promise<unknown>
		initialization: InputFrom<typeof workspaceInitialization>
		observe: () => FinanceFormsObservation
		db: Pick<
			JazzDb,
			| 'all'
			| 'one'
			| 'subscribe'
			| 'insert'
			| 'insertStreaming'
			| 'update'
			| 'delete'
			| 'beginTransaction'
			| 'beginSerializableTransaction'
			| 'transaction'
			| 'getConfig'
			| 'getAuthState'
			| 'onMutationError'
		>
	}
) {
	const sampleIncome = createWorkerSamples(
		dependencies.db,
		INCOME,
		dependencies.observe,
		dependencies.binding
	)
	const sampleExpense = createWorkerSamples(
		dependencies.db,
		EXPENSE,
		dependencies.observe,
		dependencies.binding
	)
	const integrity = createWorkspaceIntegrityOwner(dependencies.db)
	const mutations = createCallbackLogic<never>(({ sendBack }) =>
		dependencies.db.onMutationError(() => sendBack({ type: 'MUTATION_REJECTED' }))
	)
	const bankHistory = createWorkerBankHistory(dependencies.db)
	const bank = createBankSyncMachine({
		db: dependencies.db,
		read: () => dependencies.observe().bank,
		passkeyName: () => 'Delightful Finance'
	})
	const transactionDetails = createWorkerTransactionDetails(dependencies.db)
	const savedImageEditor = createSavedTransactionImageEditor(windowImageEditorMachine)
	const workspaceCreation = createWorkspaceCreationMachine(dependencies.db)
	function creationBinding(observation: FinanceFormsObservation) {
		const profile = observation.profile
		return profile.sessionReady &&
			profile.binding === dependencies.binding &&
			profile.identityId &&
			profile.profile?.id &&
			profile.profile.userId === profile.identityId
			? { key: dependencies.creationKey, userId: profile.identityId, profileId: profile.profile.id }
			: undefined
	}
	const profileName = createScopedFormMachine(dependencies.profile.name)
	const profileAvatar = createScopedFormMachine(dependencies.profile.avatar)
	const workspaceRename = createScopedFormMachine(dependencies.workspace)
	const classification = createClassificationOwner(dependencies.classification)
	const accountOrder = createAccountOrderPersistenceMachine(dependencies.accountOrderStorage)
	const archive = createAccountArchiveMachine(
		(request) => {
			const current = dependencies.observe()
			if (
				current.creation.binding !== dependencies.binding ||
				current.archive.binding !== request.binding ||
				current.archive.identityId !== request.identityId ||
				current.archive.organizationId !== request.organizationId
			)
				return Promise.reject(new Error('Finance archive scope retired'))
			return dependencies.archive(request.accountId)
		},
		() => dependencies.observe().archive
	)
	const options = createAccountCreationFormOptions({
		...dependencies,
		observe: () => dependencies.observe().creation
	})
	const transactionOptions = createTransactionEntryFormOptions({
		...dependencies,
		observe: () => dependencies.observe().transaction
	})
	const editOptions = createTransactionEditFormOptions({
		...dependencies,
		observe: () => dependencies.observe().edit
	})
	function transferScope(observation: FinanceFormsObservation) {
		const source = observation.transferCreate
		return source.sessionReady &&
			source.binding === dependencies.binding &&
			source.organizationId &&
			source.identityId
			? {
					binding: dependencies.binding,
					workspaceId: source.organizationId,
					generation: observation.navigation.generation
				}
			: undefined
	}
	const transferGateway: TransferMutationGateway = {
		captureScope: (request: TransferMutationRequestInput) => {
			const observation = dependencies.observe()
			return request.input.db === dependencies.db &&
				request.input.identityId === observation.transferCreate.identityId &&
				request.workspaceId === observation.transferCreate.organizationId
				? transferScope(observation)
				: undefined
		},
		send: dependencies.transferDispatch
	}
	const transferOwner = createWorkerTransferOwner()
	const transferOptions = createInternalTransferEntryFormOptions({
		binding: dependencies.binding,
		db: dependencies.db,
		observe: () => dependencies.observe().transferCreate,
		mutationGateway: transferGateway
	})
	const enterTransfer = createScopedFormMachine(transferOptions)
	const editWorkflow = createTransactionEditMachine(
		editOptions,
		dependencies.db,
		undefined,
		transferGateway
	)
	const editTransaction = editWorkflow.logic
	const enterTransaction = createScopedFormMachine(transactionOptions)
	const createAccount = createScopedFormMachine(options)
	type Input = { observation: FinanceFormsObservation; selectionRevision: number; offline: boolean }
	type Context = Input & {
		sampleIncome: z.output<typeof workerSamplesView>['income'] | undefined
		sampleExpense: z.output<typeof workerSamplesView>['expense'] | undefined
		integrityRequest: IntegrityRequest
		integrityReport: IntegrityReport | undefined
		mutationRejected: boolean
		bank: ReturnType<typeof selectBankReport> | undefined
		bankHistory: ReturnType<typeof selectWorkerBankHistoryReport> | undefined
		details: ReturnType<typeof selectWorkerTransactionDetails> | undefined
		savedImages: z.output<typeof workerSavedImageView> | undefined
		removals: ReturnType<typeof selectTransactionAttachmentRemovalView> | undefined

		transferCreation: WorkerTransferCreationView | undefined
		transferCreationObservation: FinanceFormsObservation['transferCreate'] | undefined
		transferEdit: WorkerTransferEditView | undefined
		accountAccess: WorkerAccountAccessView | undefined
		backup: z.output<typeof workerBackupView> | undefined
		workspaceRestore: z.output<typeof workerWorkspaceRestoreView> | undefined
		workspaceCreation: ReturnType<typeof selectWorkspaceCreationReport> | undefined
		profileName: WorkerProfileForms['name'] | undefined
		profileNameObservation: ProfileObservation | undefined
		profileAvatar: WorkerProfileForms['avatar'] | undefined
		profileAvatarObservation: ProfileObservation | undefined
		workspaceRename: WorkerWorkspaceFormView | undefined
		workspaceRenameObservation: WorkspaceRenameObservation | undefined

		classification: ReturnType<typeof classification.selectReport> | undefined

		order: ReturnType<typeof selectPersistedAccountOrder>
		navigation: NavigationReport | undefined
		archive: ReturnType<typeof selectAccountArchiveReport> | undefined
		seedClosed: boolean
		initialization: InitializationResult | undefined
		edit: TransactionEntryView | undefined
		editObservation: TransactionEntryObservation | undefined
		creation: AccountCreationView | undefined
		creationObservation: AccountCreationObservation | undefined
		transaction: TransactionEntryView | undefined
		transactionObservation: TransactionEntryObservation | undefined
	}
	function selectedImageTransaction(observation: FinanceFormsObservation) {
		const row = observation.edit.transaction
		return row
			? { id: row.id, accountId: row.accountId, organizationId: row.organizationId }
			: { id: '', accountId: '', organizationId: '' }
	}
	function imageObservation(context: Context) {
		const current = context.observation.edit
		const details = context.details
		const view =
			details?.observation.binding === current.binding &&
			details.observation.identityId === current.identityId &&
			details.observation.organizationId === current.organizationId &&
			details.view?.transactionId === current.transactionId
				? details.view
				: null
		return {
			editable: Boolean(
				current.sessionReady &&
				!current.loading &&
				!current.failed &&
				current.transaction &&
				current.membership?.userId === current.identityId &&
				canWriteAccount(
					current.membership,
					current.organizationId,
					current.transaction.accountId,
					current.grants
				)
			),
			images: view?.images ?? [],
			blockedIds: context.removals?.removingIds ?? []
		}
	}
	function integrityBinding(
		observation: FinanceFormsObservation,
		initialization: Context['initialization']
	): IntegrityBinding | undefined {
		const source = observation.bank,
			profile = observation.profile.profile,
			member = source.membership
		if (
			initialization?.outcome !== 'ready' ||
			!profile ||
			profile.id !== initialization.identityId ||
			profile.userId !== source.userId ||
			!source.sessionReady ||
			!source.organizationId ||
			!source.userId ||
			!member ||
			member.userId !== source.userId ||
			member.organizationId !== source.organizationId
		)
			return
		return {
			userId: source.userId,
			organizationId: source.organizationId,
			profileId: profile.id,
			membershipId: member.id,
			role: member.role,
			accountAccessMode: member.accountAccessMode
		}
	}
	function bankSource(context: Context) {
		const report = context.integrityReport
		const usable =
			report &&
			sameIntegrityRequest(context.integrityRequest, report.request) &&
			(report.status.kind === 'complete' ||
				(report.status.kind === 'partial' && report.status.access === 'usable'))
		return {
			...context.observation.bank,
			sessionReady: context.observation.bank.sessionReady && !!usable
		}
	}
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			internalEvents: {
				SAMPLE_INCOME_CLOSED: types(),
				SAMPLE_EXPENSE_CLOSED: types(),
				INTEGRITY_CLOSED: types(),
				BANK_HISTORY_CLOSED: types(),
				BANK_CLOSED: types(),
				TRANSACTION_DETAILS_CLOSED: types(),
				SAVED_IMAGES_CLOSED: types(),
				IMAGE_REMOVALS_CLOSED: types(),
				TRANSFER_OWNER_CLOSED: types(),
				TRANSFER_CREATION_CLOSED: types(),
				ACCOUNT_ACCESS_CLOSED: types(),
				BACKUP_CLOSED: types(),
				WORKSPACE_RESTORE_CLOSED: types(),
				WORKSPACE_CREATION_CLOSED: types(),
				PROFILE_NAME_CLOSED: types(),
				PROFILE_AVATAR_CLOSED: types(),
				WORKSPACE_RENAME_CLOSED: types(),

				CLASSIFICATION_CLOSED: types(),

				CREATION_CLOSED: types(),
				TRANSACTION_CLOSED: types(),
				EDIT_CLOSED: types(),
				INITIALIZATION_CLOSED: types(),
				SEED_CLOSED: types(),
				NAVIGATION_CLOSED: types(),
				ARCHIVE_CLOSED: types(),
				ORDER_CLOSED: types()
			},
			events: {
				WORKSPACE_INITIALIZATION_RESULT:
					types<Omit<WorkspaceInitializationReport<InitializationResult>, 'type'>>(),
				ADD_SAMPLES: types<{ kind: TransactionEntryObservation['kind'] }>(),
				INTEGRITY_STATUS: types<{ report: IntegrityReport }>(),
				RETRY_INTEGRITY: types(),
				MUTATION_REJECTED: types(),
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
				NAVIGATION_STATUS: types<{ report: NavigationReport }>(),
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
			children: {
				seed: types<import('xstate').ActorRefFrom<typeof workerWorkspaceSeed>>(),
				sampleIncome: types<import('xstate').ActorRefFrom<typeof sampleIncome>>(),
				sampleExpense: types<import('xstate').ActorRefFrom<typeof sampleExpense>>(),
				integrity: types<import('xstate').ActorRefFrom<typeof integrity>>(),
				bankHistory: types<import('xstate').ActorRefFrom<typeof bankHistory>>(),
				bank: types<import('xstate').ActorRefFrom<typeof bank>>(),
				transactionDetails: types<import('xstate').ActorRefFrom<typeof transactionDetails>>(),
				savedImages: types<import('xstate').ActorRefFrom<typeof savedImageEditor>>(),
				imageRemovals:
					types<import('xstate').ActorRefFrom<typeof transactionAttachmentManagerMachine>>(),
				transferOwner: types<import('xstate').ActorRefFrom<typeof transferOwner>>(),
				transferCreation: types<import('xstate').ActorRefFrom<typeof enterTransfer>>(),
				accountAccess: types<import('xstate').ActorRefFrom<typeof dependencies.accountAccess>>(),
				backup: types<import('xstate').ActorRefFrom<typeof dependencies.backup>>(),
				workspaceRestore: types<import('xstate').ActorRefFrom<typeof dependencies.restore>>(),
				workspaceCreation: types<import('xstate').ActorRefFrom<typeof workspaceCreation>>(),
				profileName: types<import('xstate').ActorRefFrom<typeof profileName>>(),
				profileAvatar: types<import('xstate').ActorRefFrom<typeof profileAvatar>>(),
				workspaceRename: types<import('xstate').ActorRefFrom<typeof workspaceRename>>(),

				classification: types<import('xstate').ActorRefFrom<typeof classification.logic>>(),

				order: types<import('xstate').ActorRefFrom<typeof accountOrder>>(),
				navigation:
					types<
						import('xstate').ActorRefFrom<ReturnType<typeof createWorkspaceNavigationMachine>>
					>(),
				archive: types<import('xstate').ActorRefFrom<typeof archive>>(),
				initialization: types<import('xstate').ActorRefFrom<typeof workspaceStartup>>(),
				edit: types<import('xstate').ActorRefFrom<typeof editTransaction>>(),
				creation: types<import('xstate').ActorRefFrom<typeof createAccount>>(),
				transaction: types<import('xstate').ActorRefFrom<typeof enterTransaction>>()
			}
		},
		actors: {
			seed: workerWorkspaceSeed,
			sampleIncome,
			sampleExpense,
			integrity,
			mutations,
			bankHistory,
			bank,
			transactionDetails,
			savedImageEditor,
			imageRemovals: transactionAttachmentManagerMachine,
			transferOwner,
			enterTransfer,
			accountAccess: dependencies.accountAccess,
			backup: dependencies.backup,
			workspaceRestore: dependencies.restore,
			workspaceCreation,
			profileName,
			profileAvatar,
			workspaceRename,

			classification: classification.logic,

			accountOrder,
			createAccount,
			enterTransaction,
			editTransaction,
			workspaceStartup,
			archive,
			navigation: dependencies.navigation
		}
	}).createMachine({
		id: 'finance-forms',
		initial: 'active',
		context: ({ input }) => ({
			...input,
			sampleIncome: undefined,
			sampleExpense: undefined,
			integrityRequest: { generation: 0, binding: undefined },
			integrityReport: undefined,
			mutationRejected: false,
			bankHistory: undefined,
			bank: undefined,
			details: undefined,
			savedImages: undefined,
			removals: undefined,
			transferCreation: undefined,
			transferCreationObservation: undefined,
			transferEdit: undefined,
			accountAccess: undefined,
			backup: undefined,
			workspaceRestore: undefined,
			workspaceCreation: undefined,
			profileName: undefined,
			profileNameObservation: undefined,
			profileAvatar: undefined,
			profileAvatarObservation: undefined,
			workspaceRename: undefined,
			workspaceRenameObservation: undefined,

			classification: undefined,

			order: undefined,
			navigation: undefined,
			archive: undefined,
			initialization: undefined,
			seedClosed: false,
			edit: undefined,
			editObservation: undefined,
			creation: undefined,
			creationObservation: undefined,
			transaction: undefined,
			transactionObservation: undefined
		}),
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
				),
			CANCEL_TRANSFER_MUTATION: ({ event }, enq) => enq.sendTo('transferOwner', event)
		},
		invoke: [
			{
				id: 'sampleIncome',
				src: 'sampleIncome',
				onSnapshot: ({ event }) => ({
					context: { sampleIncome: selectSampleTransactionsView(event.snapshot) }
				}),
				onDone: ({ value, event }, enq) => {
					if (!matchesState('closing', value) || event.output.outcome === 'unresolved')
						return { target: '.failed' }
					enq.raise({ type: 'SAMPLE_INCOME_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'sampleExpense',
				src: 'sampleExpense',
				onSnapshot: ({ event }) => ({
					context: { sampleExpense: selectSampleTransactionsView(event.snapshot) }
				}),
				onDone: ({ value, event }, enq) => {
					if (!matchesState('closing', value) || event.output.outcome === 'unresolved')
						return { target: '.failed' }
					enq.raise({ type: 'SAMPLE_EXPENSE_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{ src: 'mutations', onError: { target: '.failed' } },
			{
				id: 'integrity',
				src: 'integrity',
				input: ({ context, self }) => ({ request: context.integrityRequest, recipient: self }),
				onDone: ({ value, event }, enq) => {
					if (!matchesState('closing', value) || event.output.outcome === 'unresolved')
						return { target: '.failed' }
					enq.raise({ type: 'INTEGRITY_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'bankHistory',
				src: 'bankHistory',
				input: ({ context }) => ({
					source: context.observation.bank,
					visible: context.observation.navigation.pathname === '/settings/banks'
				}),
				onSnapshot: ({ event }) => ({
					context: { bankHistory: selectWorkerBankHistoryReport(event.snapshot) }
				}),
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'BANK_HISTORY_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'bank',
				src: 'bank',
				onSnapshot: ({ event }) => ({ context: { bank: selectBankReport(event.snapshot) } }),
				onDone: ({ value, event }, enq) => {
					if (!matchesState('closing', value) || event.output.outcome === 'unresolved')
						return { target: '.failed' }
					enq.raise({ type: 'BANK_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'transactionDetails',
				src: 'transactionDetails',
				input: ({ context }) => ({ observation: context.observation.edit }),
				onSnapshot: ({ context, event, value }, enq) => {
					const details = selectWorkerTransactionDetails(event.snapshot)
					if (details.observation !== context.observation.edit) return
					if (matchesState('active', value))
						enq.sendTo('savedImages', {
							type: 'OBSERVE',
							observation: imageObservation({ ...context, details }),
							transaction: selectedImageTransaction(context.observation)
						})
					return { context: { details } }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'TRANSACTION_DETAILS_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'imageRemovals',
				src: 'imageRemovals',
				input: ({ context }) => ({
					db: dependencies.db,
					transactionId: context.observation.edit.transactionId ?? ''
				}),
				onSnapshot: ({ context, event, value }, enq) => {
					const removals = selectTransactionAttachmentRemovalView(event.snapshot)
					if (matchesState('active', value))
						enq.sendTo('savedImages', {
							type: 'OBSERVE',
							observation: imageObservation({ ...context, removals }),
							transaction: selectedImageTransaction(context.observation)
						})
					return { context: { removals } }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'IMAGE_REMOVALS_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'savedImages',
				src: 'savedImageEditor',
				input: ({ context }) => ({
					db: dependencies.db,
					transaction: selectedImageTransaction(context.observation),
					observation: imageObservation(context)
				}),
				onSnapshot: ({ event }) => {
					const view = workerSavedImageView.safeParse(savedImageEditorReport(event.snapshot))
					return view.success ? { context: { savedImages: view.data } } : { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'SAVED_IMAGES_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'transferOwner',
				src: 'transferOwner',
				input: ({ context }) => ({ scope: transferScope(context.observation) }),
				onDone: ({ value, event }, enq) => {
					if (!matchesState('closing', value) || event.output.outcome !== 'closed')
						return { target: '.failed' }
					enq.raise({ type: 'TRANSFER_OWNER_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'transferCreation',
				src: 'enterTransfer',
				input: ({ context }) => context.observation.transferCreate,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.transferCreate)
						return
					const parsed = workerTransferCreationView.safeParse(
						selectScopedFormView(event.snapshot, transferOptions)
					)
					return parsed.success
						? {
								context: {
									transferCreation: parsed.data,
									transferCreationObservation: context.observation.transferCreate
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'TRANSFER_CREATION_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'accountAccess',
				src: 'accountAccess',
				onSnapshot: ({ context, event }) => {
					const report = selectAccountDeleteGrantReport(event.snapshot)
					const current = context.observation.accountAccess
					if (
						report.binding !== current.binding ||
						report.identityId !== current.identityId ||
						report.organizationId !== current.organizationId
					)
						return
					const view = workerAccountAccessView.safeParse(report.view)
					return view.success ? { context: { accountAccess: view.data } } : { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'ACCOUNT_ACCESS_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'backup',
				src: 'backup',
				input: {},
				onSnapshot: ({ context, event }) => {
					const report = selectWorkspaceBackupReport(event.snapshot)
					if (!sameBackupObservation(report.facts, context.observation.backup)) return
					const view = workerBackupView.safeParse(report.view)
					return view.success ? { context: { backup: view.data } } : { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'BACKUP_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'workspaceRestore',
				src: 'workspaceRestore',
				onSnapshot: ({ event, value }, enq) => {
					const view = workerWorkspaceRestoreView.safeParse(
						selectWorkspaceRestoreReport(event.snapshot).view
					)
					if (!view.success) return { target: '.failed' }
					if (matchesState('closing', value) && !view.data.busy)
						enq.raise({ type: 'WORKSPACE_RESTORE_CLOSED' })
					return { context: { workspaceRestore: view.data } }
				},
				onError: { target: '.failed' }
			},
			{
				id: 'workspaceCreation',
				src: 'workspaceCreation',
				input: ({ context }) => ({ binding: creationBinding(context.observation) }),
				onSnapshot: ({ event }) => ({
					context: { workspaceCreation: selectWorkspaceCreationReport(event.snapshot) }
				}),
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'WORKSPACE_CREATION_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'profileName',
				src: 'profileName',
				input: ({ context }) => context.observation.profile,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.profile) return
					const view = workerProfileFormView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.profile.name)
					)
					return view.success
						? {
								context: {
									profileName: view.data,
									profileNameObservation: context.observation.profile
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'PROFILE_NAME_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'profileAvatar',
				src: 'profileAvatar',
				input: ({ context }) => context.observation.profile,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.profile) return
					const view = workerProfileFormView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.profile.avatar)
					)
					return view.success
						? {
								context: {
									profileAvatar: view.data,
									profileAvatarObservation: context.observation.profile
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'PROFILE_AVATAR_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'workspaceRename',
				src: 'workspaceRename',
				input: ({ context }) => context.observation.workspace,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.workspace) return
					const view = workerWorkspaceFormView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.workspace)
					)
					return view.success
						? {
								context: {
									workspaceRename: view.data,
									workspaceRenameObservation: context.observation.workspace
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'WORKSPACE_RENAME_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'classification',
				src: 'classification',
				input: ({ context }) => context.observation.classification,
				onSnapshot: ({ context, event }) => {
					const report = classification.selectReport(event.snapshot)
					if (report.observation !== context.observation.classification) return
					return report.failed ? { target: '.failed' } : { context: { classification: report } }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'CLASSIFICATION_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'order',
				src: 'accountOrder',
				input: ({ context }) => ({ observation: context.observation.order }),
				onSnapshot: ({ event }) =>
					event.snapshot.status === 'error' ||
					event.snapshot.status === 'stopped' ||
					event.snapshot.matches('failed')
						? { target: '.failed' }
						: { context: { order: selectPersistedAccountOrder(event.snapshot) } },
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'ORDER_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'navigation',
				src: 'navigation',
				input: ({ context, self }) => ({ facts: context.observation.navigation, recipient: self }),
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'NAVIGATION_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'archive',
				src: 'archive',
				onSnapshot: ({ context, event }) => {
					if (event.snapshot.status === 'error' || event.snapshot.status === 'stopped')
						return { target: '.failed' }
					const archive = selectAccountArchiveReport(event.snapshot)
					return archive.binding === context.observation.archive.binding
						? { context: { archive } }
						: undefined
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'ARCHIVE_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'seed',
				src: 'seed',
				input: () => ({ db: dependencies.db, userId: dependencies.initialization.userId }),
				onDone: ({ event, value }, enq) => {
					if (event.output.outcome !== 'closed') return { target: '.failed' }
					if (matchesState('closing', value)) enq.raise({ type: 'SEED_CLOSED' })
					return { context: { seedClosed: true } }
				},
				onError: { target: '.failed' }
			},
			{
				id: 'initialization',
				src: 'workspaceStartup',
				input: ({ self }) => ({
					binding: dependencies.binding,
					initialization: dependencies.initialization,
					recipient: self
				}),
				onDone: ({ value, event }, enq) => {
					if (!matchesState('closing', value) || event.output.outcome !== 'closed')
						return { target: '.failed' }
					enq.raise({ type: 'INITIALIZATION_CLOSED' })
					return { context: { initialization: event.output.initialization } }
				},
				onError: { target: '.failed' }
			},
			{
				id: 'creation',
				src: 'createAccount',
				input: ({ context }) => context.observation.creation,
				onSnapshot: ({ context, event }) =>
					selectScopedFormObservation(event.snapshot) === context.observation.creation
						? {
								context: {
									creationObservation: context.observation.creation,
									creation: selectScopedFormView(event.snapshot, options)
								}
							}
						: undefined,
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'CREATION_CLOSED' })
				},
				onError: { target: '.failed', context: { creation: undefined } }
			},
			{
				id: 'transaction',
				src: 'enterTransaction',
				input: ({ context }) => context.observation.transaction,
				onSnapshot: ({ context, event }) =>
					selectScopedFormObservation(event.snapshot) === context.observation.transaction
						? {
								context: {
									transactionObservation: context.observation.transaction,
									transaction: selectScopedFormView(event.snapshot, transactionOptions)
								}
							}
						: undefined,
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'TRANSACTION_CLOSED' })
				},
				onError: { target: '.failed', context: { transaction: undefined } }
			},
			{
				id: 'edit',
				src: 'editTransaction',
				input: ({ context }) => context.observation.edit,
				onSnapshot: ({ context, event, value }, enq) => {
					const report = editWorkflow.selectReport(event.snapshot)
					if (report.observation !== context.observation.edit) return
					if (matchesState('active', value))
						enq.sendTo('savedImages', {
							type: 'OBSERVE',
							observation: imageObservation({ ...context, edit: report.form }),
							transaction: selectedImageTransaction(context.observation)
						})
					const facts = context.observation.transfers
					const source = report.observation.transaction
					const linked = report.linkedTransfer
					const counterpartId =
						linked && source
							? linked.expenseTransactionId === source.id
								? linked.incomeTransactionId
								: linked.expenseTransactionId
							: null
					const state = report.state
					const view = workerTransferEditView.safeParse({
						state,
						searchEnabled: ['searching', 'matches', 'empty', 'failed'].includes(state),
						conflict: state === 'conflicted',
						suggestions: report.candidates.flatMap((candidate) => {
							const row = facts.transactions.find((row) => row.id === candidate.id)
							return row
								? [
										{
											...row,
											accountName: report.observation.accounts.find(
												(account) => account.id === row.accountId
											)?.name
										}
									]
								: []
						}),
						writableCandidateIds: report.writableCandidateIds,
						selectedCandidateId: report.selectedCandidateId,
						linkPending: report.linkPending,
						unlinkPending: report.unlinkPending,
						deletePending: report.deletePending,
						status: report.status,
						deleteFeedback: report.deleteFeedback,
						unlinkAvailable: linked !== null,
						unlinkWritable: report.unlinkWritable,
						deleteAvailable: report.deleteAvailable,
						linkedCounterpartHref:
							counterpartId && source
								? `${transactionPages[source.kind === EXPENSE ? INCOME : EXPENSE].path}/${encodeURIComponent(counterpartId)}`
								: null
					})
					return view.success
						? {
								context: {
									editObservation: report.observation,
									edit: report.form,
									transferEdit: view.data
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'EDIT_CLOSED' })
				},
				onError: { target: '.failed', context: { edit: undefined } }
			}
		],
		states: {
			active: {
				entry: ({ context }, enq) => {
					enq.sendTo('edit', { type: 'TRANSFER_FACTS', facts: context.observation.transfers })
					enq.sendTo('bank', { type: 'NETWORK_CHANGED', offline: context.offline })
					enq.sendTo('bank', { type: 'SOURCE_OBSERVED', source: bankSource(context) })
				},
				on: {
					WORKSPACE_INITIALIZATION_RESULT: ({ context, event }, enq) => {
						if (event.binding !== dependencies.binding) return
						if (event.provenance)
							enq.sendTo('seed', {
								type: 'INITIALIZED',
								workspaceId: event.provenance.initialWorkspaceId
							})
						const request = {
							generation: context.integrityRequest.generation + 1,
							binding: integrityBinding(context.observation, event.initialization)
						}
						enq.sendTo('integrity', { type: 'OBSERVED', request })
						return {
							context: {
								initialization: event.initialization,
								integrityRequest: request,
								integrityReport: undefined
							}
						}
					},
					TRANSFER_MUTATION_REQUEST: ({ context, event }, enq) => {
						const current = transferScope(context.observation)
						const request = event.request
						if (
							current &&
							request.scope?.binding === current.binding &&
							request.scope.workspaceId === current.workspaceId &&
							request.scope.generation === current.generation &&
							request.input.db === dependencies.db &&
							request.input.identityId === context.observation.transferCreate.identityId
						)
							enq.sendTo('transferOwner', { type: 'REQUEST', request })
						else
							enq(() =>
								request.recipient.send({
									type: 'TRANSFER_MUTATION_RESULT',
									requestId: request.requestId,
									result: rejectedTransferMutation(request)
								})
							)
					},
					TRANSFER_EDIT: ({ context, event }, enq) => {
						enq.sendTo('edit', event.command)
						enq.sendTo('edit', { type: 'TRANSFER_FACTS', facts: context.observation.transfers })
					},
					ADD_SAMPLES: ({ context, event }, enq) => {
						if (!debugEnabled) return
						enq.sendTo(event.kind === INCOME ? 'sampleIncome' : 'sampleExpense', {
							type: 'ADD',
							scope: {
								...transactionEntryScope({ ...context.observation.transaction, kind: event.kind }),
								accountIds: context.observation.sampleSelectedAccounts
							}
						})
					},
					INTEGRITY_STATUS: ({ context, event }, enq) => {
						if (!sameIntegrityRequest(context.integrityRequest, event.report.request)) return
						enq.sendTo('bank', {
							type: 'SOURCE_OBSERVED',
							source: bankSource({ ...context, integrityReport: event.report })
						})
						return { context: { integrityReport: event.report } }
					},
					RETRY_INTEGRITY: ({ context }, enq) => {
						const request = {
							generation: context.integrityRequest.generation + 1,
							binding: integrityBinding(context.observation, context.initialization)
						}
						enq.sendTo('integrity', { type: 'OBSERVED', request })
						return { context: { integrityRequest: request, integrityReport: undefined } }
					},
					MUTATION_REJECTED: () => ({ context: { mutationRejected: true } }),
					DISMISS_MUTATION_NOTICE: () => ({ context: { mutationRejected: false } }),
					BANK_HISTORY: ({ event }, enq) => enq.sendTo('bankHistory', event.command),
					BANK: ({ event }, enq) => enq.sendTo('bank', event.event),
					BANK_NETWORK: ({ event }, enq) => {
						enq.sendTo('bank', { type: 'NETWORK_CHANGED', offline: event.offline })
						return { context: { offline: event.offline } }
					},
					TRANSFER_ENTRY: ({ event }, enq) => enq.sendTo('transferCreation', event.command),
					TRANSACTION_IMAGE: ({ context, event }, enq) => {
						const observation = imageObservation(context)
						const command = event.command
						if (command.type === 'CLOSE') {
							enq.sendTo('savedImages', command)
							return
						}
						if (
							!observation.editable ||
							!observation.images.some((image) => image.id === command.attachmentId) ||
							observation.blockedIds.includes(command.attachmentId)
						)
							return
						if (command.type === 'REMOVE') enq.sendTo('imageRemovals', command)
						else enq.sendTo('savedImages', command)
					},
					NAVIGATION_STATUS: ({ context, event }) =>
						event.report.generation === context.observation.navigation.generation
							? { context: { navigation: event.report } }
							: undefined,
					SELECT_WORKSPACE: ({ event }, enq) =>
						enq.sendTo('navigation', { type: 'SELECT', workspaceId: event.workspaceId }),
					NAVIGATE: ({ event }, enq) => enq.sendTo('navigation', event),
					RETRY_NAVIGATION: (_, enq) => enq.sendTo('navigation', { type: 'RETRY' }),
					OBSERVE: ({ context, event }, enq) => {
						if (
							context.observation.transaction.binding !== event.observation.transaction.binding ||
							context.observation.transaction.organizationId !==
								event.observation.transaction.organizationId ||
							JSON.stringify(context.observation.sampleSelectedAccounts) !==
								JSON.stringify(event.observation.sampleSelectedAccounts)
						) {
							enq.sendTo('sampleIncome', { type: 'INVALIDATE' })
							enq.sendTo('sampleExpense', { type: 'INVALIDATE' })
						} else {
							enq.sendTo('sampleIncome', {
								type: 'OBSERVE',
								observation: {
									revision: event.selectionRevision,
									facts: { ...event.observation.transaction, kind: INCOME }
								}
							})
							enq.sendTo('sampleExpense', {
								type: 'OBSERVE',
								observation: {
									revision: event.selectionRevision,
									facts: { ...event.observation.transaction, kind: EXPENSE }
								}
							})
						}
						const binding = integrityBinding(event.observation, context.initialization)
						const request = sameIntegrityBinding(binding, context.integrityRequest.binding)
							? context.integrityRequest
							: { generation: context.integrityRequest.generation + 1, binding }
						const integrityReport =
							request === context.integrityRequest ? context.integrityReport : undefined
						if (request !== context.integrityRequest)
							enq.sendTo('integrity', { type: 'OBSERVED', request })

						enq.sendTo('bankHistory', {
							type: 'OBSERVE',
							source: event.observation.bank,
							visible: event.observation.navigation.pathname === '/settings/banks'
						})
						enq.sendTo('bank', {
							type: 'SOURCE_OBSERVED',
							source: bankSource({
								...context,
								observation: event.observation,
								integrityRequest: request,
								integrityReport
							})
						})
						enq.sendTo('transactionDetails', {
							type: 'OBSERVE',
							observation: event.observation.edit
						})
						enq.sendTo('savedImages', {
							type: 'OBSERVE',
							observation: imageObservation({ ...context, observation: event.observation }),
							transaction: selectedImageTransaction(event.observation)
						})
						if (context.observation.edit.transactionId !== event.observation.edit.transactionId)
							enq.sendTo('imageRemovals', {
								type: 'SCOPE',
								transactionId: event.observation.edit.transactionId ?? ''
							})
						enq.sendTo('transferOwner', {
							type: 'OBSERVE',
							scope: transferScope(event.observation)
						})
						enq.sendTo('transferCreation', {
							type: 'OBSERVE',
							observation: event.observation.transferCreate
						})
						enq.sendTo('accountAccess', {
							type: 'OBSERVE',
							observation: event.observation.accountAccess
						})
						enq.sendTo('backup', { type: 'OBSERVE', facts: event.observation.backup })
						enq.sendTo('workspaceCreation', {
							type: 'OBSERVED',
							binding: creationBinding(event.observation)
						})
						enq.sendTo('profileName', { type: 'OBSERVE', observation: event.observation.profile })
						enq.sendTo('profileAvatar', { type: 'OBSERVE', observation: event.observation.profile })
						enq.sendTo('workspaceRename', {
							type: 'OBSERVE',
							observation: event.observation.workspace
						})
						enq.sendTo('navigation', { type: 'OBSERVED', facts: event.observation.navigation })
						enq.sendTo('archive', { type: 'OBSERVE', observation: event.observation.archive })
						enq.sendTo('order', { type: 'OBSERVE', observation: event.observation.order })
						if (event.observation.navigation.pathname !== context.observation.navigation.pathname) {
							enq.sendTo('transaction', { type: 'CANCEL' })
							enq.sendTo('transferCreation', { type: 'CANCEL' })
							enq.sendTo('transaction', { type: 'RESET' })
							enq.sendTo('transferCreation', { type: 'RESET' })
							enq.sendTo('classification', { type: 'RESET' })
						}
						enq.sendTo('classification', {
							type: 'OBSERVE',
							observation: event.observation.classification
						})

						enq.sendTo('edit', { type: 'OBSERVE', observation: event.observation.edit })
						enq.sendTo('edit', { type: 'TRANSFER_FACTS', facts: event.observation.transfers })
						enq.sendTo('creation', { type: 'OBSERVE', observation: event.observation.creation })
						enq.sendTo('transaction', {
							type: 'OBSERVE',
							observation: event.observation.transaction
						})
						return {
							context: {
								integrityRequest: request,
								integrityReport,
								observation: event.observation,
								selectionRevision: event.selectionRevision
							}
						}
					},
					ARCHIVE_ACCOUNT: ({ event }, enq) => {
						enq.sendTo('archive', { type: 'ARCHIVE', accountId: event.accountId })
					},
					SET_ACCOUNT_DELETE_GRANT: ({ event }, enq) =>
						enq.sendTo('accountAccess', {
							type: 'SET_DELETE',
							accountId: event.accountId,
							userId: event.userId,
							canDelete: event.canDelete
						}),
					START_BACKUP: ({ event }, enq) =>
						enq.sendTo('backup', { type: 'SUBMIT', submission: event.submission }),
					START_WORKSPACE_RESTORE: ({ event }, enq) =>
						enq.sendTo('workspaceRestore', { type: 'SUBMIT', request: event.request }),
					BACKUP_COMMAND: ({ context, event }, enq) => {
						if (event.command === 'RELOAD') {
							if (context.backup?.canReload) enq(dependencies.reload)
							return
						}
						enq.sendTo('backup', { type: event.command })
					},
					WORKSPACE_RESTORE_COMMAND: ({ context, event }, enq) => {
						if (event.command === 'RELOAD') {
							if (context.workspaceRestore?.canReload) enq(dependencies.reload)
							return
						}
						enq.sendTo('workspaceRestore', { type: event.command })
					},
					WORKSPACE_CREATION: ({ event }, enq) => enq.sendTo('workspaceCreation', event.command),
					PROFILE: ({ event }, enq) =>
						enq.sendTo(event.form === 'name' ? 'profileName' : 'profileAvatar', event.command),
					WORKSPACE_SETTINGS: ({ event }, enq) => enq.sendTo('workspaceRename', event.command),
					CLASSIFICATION: ({ event }, enq) => enq.sendTo('classification', event),
					ACCOUNT_ORDER: ({ event }, enq) => {
						enq.sendTo('order', { type: 'COMMAND', command: event.command })
					},
					ACCOUNT_CREATION: ({ event }, enq) => {
						enq.sendTo('creation', event.command)
					},
					TRANSACTION_EDIT: ({ event }, enq) => {
						enq.sendTo('edit', { type: 'FORM', event: event.command })
					},
					TRANSACTION_ENTRY: ({ event }, enq) => {
						enq.sendTo('transaction', event.command)
					},
					SHUTDOWN: ({ self, context }, enq) => {
						const seed = self.getSnapshot().children.seed
						if (seed?.getSnapshot().status === 'active') enq.sendTo(seed, { type: 'SHUTDOWN' })
						enq.sendTo('initialization', { type: 'SHUTDOWN' })
						enq.sendTo('navigation', { type: 'SHUTDOWN' })
						enq.sendTo('archive', { type: 'SHUTDOWN' })
						enq.sendTo('order', { type: 'SHUTDOWN' })
						enq.sendTo('accountAccess', { type: 'SHUTDOWN' })
						enq.sendTo('backup', { type: 'SHUTDOWN' })
						enq.sendTo('workspaceRestore', { type: 'DRAIN' })
						if (context.workspaceRestore && !context.workspaceRestore.busy)
							enq.raise({ type: 'WORKSPACE_RESTORE_CLOSED' })
						enq.sendTo('workspaceCreation', { type: 'SHUTDOWN' })
						enq.sendTo('profileName', { type: 'SHUTDOWN' })
						enq.sendTo('profileAvatar', { type: 'SHUTDOWN' })
						enq.sendTo('workspaceRename', { type: 'SHUTDOWN' })

						enq.sendTo('classification', { type: 'SHUTDOWN' })

						enq.sendTo('sampleIncome', { type: 'SHUTDOWN' })
						enq.sendTo('sampleExpense', { type: 'SHUTDOWN' })
						enq.sendTo('integrity', { type: 'SHUTDOWN' })
						enq.sendTo('bankHistory', { type: 'SHUTDOWN' })
						enq.sendTo('bank', { type: 'SHUTDOWN' })
						enq.sendTo('transactionDetails', { type: 'SHUTDOWN' })
						enq.sendTo('savedImages', { type: 'SHUTDOWN' })
						enq.sendTo('imageRemovals', { type: 'SHUTDOWN' })
						enq.sendTo('transferOwner', { type: 'SHUTDOWN' })
						enq.sendTo('transferCreation', { type: 'SHUTDOWN' })
						enq.sendTo('edit', { type: 'SHUTDOWN' })
						enq.sendTo('creation', { type: 'SHUTDOWN' })
						enq.sendTo('transaction', { type: 'SHUTDOWN' })
						return { target: 'closing' }
					}
				}
			},
			closing: {
				type: 'parallel',
				on: { SHUTDOWN: {}, NAVIGATION_STATUS: {} },
				onDone: { target: 'closed' },
				states: {
					sampleIncome: {
						initial: 'waiting',
						states: {
							waiting: { on: { SAMPLE_INCOME_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					sampleExpense: {
						initial: 'waiting',
						states: {
							waiting: { on: { SAMPLE_EXPENSE_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					integrity: {
						initial: 'waiting',
						states: {
							waiting: { on: { INTEGRITY_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					bankHistory: {
						initial: 'waiting',
						states: {
							waiting: { on: { BANK_HISTORY_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					bank: {
						initial: 'waiting',
						states: {
							waiting: { on: { BANK_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					transactionDetails: {
						initial: 'waiting',
						states: {
							waiting: { on: { TRANSACTION_DETAILS_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					savedImages: {
						initial: 'waiting',
						states: {
							waiting: { on: { SAVED_IMAGES_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					imageRemovals: {
						initial: 'waiting',
						states: {
							waiting: { on: { IMAGE_REMOVALS_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					transferOwner: {
						initial: 'waiting',
						states: {
							waiting: { on: { TRANSFER_OWNER_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					transferCreation: {
						initial: 'waiting',
						states: {
							waiting: { on: { TRANSFER_CREATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					profileName: {
						initial: 'waiting',
						states: {
							waiting: { on: { PROFILE_NAME_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					profileAvatar: {
						initial: 'waiting',
						states: {
							waiting: { on: { PROFILE_AVATAR_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					workspaceRename: {
						initial: 'waiting',
						states: {
							waiting: { on: { WORKSPACE_RENAME_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					workspaceCreation: {
						initial: 'waiting',
						states: {
							waiting: { on: { WORKSPACE_CREATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					backup: {
						initial: 'waiting',
						states: {
							waiting: { on: { BACKUP_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					workspaceRestore: {
						initial: 'waiting',
						states: {
							waiting: { on: { WORKSPACE_RESTORE_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					accountAccess: {
						initial: 'waiting',
						states: {
							waiting: { on: { ACCOUNT_ACCESS_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					classification: {
						initial: 'waiting',
						states: {
							waiting: { on: { CLASSIFICATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					order: {
						initial: 'waiting',
						states: {
							waiting: { on: { ORDER_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					navigation: {
						initial: 'waiting',
						states: {
							waiting: { on: { NAVIGATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					archive: {
						initial: 'waiting',
						states: {
							waiting: { on: { ARCHIVE_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					seed: {
						initial: 'assessing',
						states: {
							assessing: {
								type: 'choice',
								choice: ({ context }) => ({ target: context.seedClosed ? 'closed' : 'waiting' })
							},
							waiting: { on: { SEED_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					initialization: {
						initial: 'waiting',
						states: {
							waiting: { on: { INITIALIZATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					edit: {
						initial: 'waiting',
						states: {
							waiting: { on: { EDIT_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					creation: {
						initial: 'waiting',
						states: {
							waiting: { on: { CREATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					transaction: {
						initial: 'waiting',
						states: {
							waiting: { on: { TRANSACTION_CLOSED: { target: 'closed' } } },
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
	const navigation =
		snapshot.context.navigation?.generation === snapshot.context.observation.navigation.generation
			? snapshot.context.navigation
			: undefined
	const archive =
		snapshot.context.archive?.binding === snapshot.context.observation.archive.binding
			? snapshot.context.archive
			: undefined
	const order =
		snapshot.context.order?.key === snapshot.context.observation.order.key
			? snapshot.context.order
			: undefined
	const c = snapshot.context
	const sampleView = workerSamplesView.safeParse({
		income: c.sampleIncome,
		expense: c.sampleExpense
	})
	const samples = sampleView.success ? sampleView.data : null
	const integrity = selectWorkspaceIntegrityView(c.integrityReport)
	const mutationRejected = c.mutationRejected
	const bankSource = c.observation.bank
	const bankCurrent =
		c.bank?.access.organizationId === bankSource.organizationId &&
		c.bank.access.userId === bankSource.userId
			? c.bank
			: undefined
	const history =
		c.bankHistory?.source.organizationId === bankSource.organizationId &&
		c.bankHistory.source.userId === bankSource.userId
			? c.bankHistory.view
			: null
	const bankParsed = workerBankView.safeParse(
		bankCurrent && {
			view: bankCurrent.view,
			canSync: bankCurrent.canOperate,
			continueOnNavigation: bankCurrent.continueOnNavigation,
			offline: c.offline,
			history
		}
	)
	const bank = bankParsed.success ? bankParsed.data : null
	const details = c.details?.observation === c.observation.edit ? c.details.view : null
	const transactionDetails = details
		? {
				...details,
				editor: c.savedImages ?? null,
				removingIds: c.removals?.removingIds ?? [],
				failedIds: c.removals?.failedIds ?? []
			}
		: null
	const transferCreation =
		c.transferCreationObservation === c.observation.transferCreate
			? (c.transferCreation ?? null)
			: null
	const transferEdit = c.editObservation === c.observation.edit ? (c.transferEdit ?? null) : null
	const accountAccess = c.accountAccess ?? null
	const backup = c.backup ?? null
	const workspaceRestore = c.workspaceRestore ?? null
	const creationReport = c.workspaceCreation
	const created = workerWorkspaceCreationView.safeParse(creationReport?.view)
	const workspaceCreation =
		creationReport?.binding?.userId === c.observation.profile.identityId &&
		creationReport.binding.profileId === c.observation.profile.profile?.id &&
		created.success
			? created.data
			: null
	const profileView = workerProfileForms.safeParse({ name: c.profileName, avatar: c.profileAvatar })
	const profile =
		c.profileNameObservation === c.observation.profile &&
		c.profileAvatarObservation === c.observation.profile &&
		profileView.success
			? profileView.data
			: null
	const workspace =
		c.workspaceRenameObservation === c.observation.workspace && c.workspaceRename
			? c.workspaceRename
			: null
	const classification =
		c.classification?.observation === c.observation.classification ? c.classification.view : null
	const selectionRevision = snapshot.context.selectionRevision
	const result = snapshot.context.initialization
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
	if (snapshot.status !== 'active' || snapshot.matches('failed'))
		return {
			samples,
			canRetryInitialization,
			integrity,
			mutationRejected,
			bank,
			transactionDetails,
			transferCreation,
			transferEdit,
			accountAccess,
			backup,
			workspaceRestore,
			workspaceCreation,
			profile,
			workspace,
			classification,
			order,
			navigation,
			archive,
			selectionRevision,
			initialization,
			status: 'failed',
			creation: null,
			transaction: null,
			edit: null
		}
	const { context } = snapshot
	if (
		!context.edit ||
		context.editObservation !== context.observation.edit ||
		context.details?.observation !== context.observation.edit ||
		context.transferCreationObservation !== context.observation.transferCreate ||
		context.profileNameObservation !== context.observation.profile ||
		context.profileAvatarObservation !== context.observation.profile ||
		!context.creation ||
		!context.transaction ||
		context.creationObservation !== context.observation.creation ||
		context.transactionObservation !== context.observation.transaction
	)
		return {
			samples,
			canRetryInitialization,
			integrity,
			mutationRejected,
			bank,
			transactionDetails,
			transferCreation,
			transferEdit,
			accountAccess,
			backup,
			workspaceRestore,
			workspaceCreation,
			profile,
			workspace,
			classification,
			order,
			navigation,
			archive,
			selectionRevision,
			initialization,
			status: 'loading',
			creation: null,
			transaction: null,
			edit: null
		}
	const creation = workerAccountCreationView.safeParse(context.creation)
	const transaction = workerTransactionEntryView.safeParse(context.transaction)
	const edit = workerTransactionEntryView.safeParse(context.edit)
	return creation.success && transaction.success && edit.success
		? {
				samples,
				canRetryInitialization,
				integrity,
				mutationRejected,
				bank,
				transactionDetails,
				transferCreation,
				transferEdit,
				accountAccess,
				backup,
				workspaceRestore,
				workspaceCreation,
				profile,
				workspace,
				classification,
				order,
				navigation,
				archive,
				selectionRevision,
				initialization,
				status: 'ready',
				creation: creation.data,
				transaction: transaction.data,
				edit: edit.data
			}
		: {
				samples,
				canRetryInitialization,
				integrity,
				mutationRejected,
				bank,
				transactionDetails,
				transferCreation,
				transferEdit,
				accountAccess,
				backup,
				workspaceRestore,
				workspaceCreation,
				profile,
				workspace,
				classification,
				order,
				navigation,
				archive,
				selectionRevision,
				initialization,
				status: 'failed',
				creation: null,
				transaction: null,
				edit: null
			}
}
