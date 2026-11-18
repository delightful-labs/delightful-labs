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
	TransactionEntryReason,
	TransactionEntryScope,
	TransactionEntryView
} from '../../contracts/transaction-entry-contract.js'
import type { TransactionSaveValues } from '../../validation/transactions.js'
import type { Account } from '../../schema.js'
import type { AccountFormValues } from '../../validation/accounts.js'
import type {
	AccountCreationObservation,
	AccountCreationReason,
	AccountCreationScope,
	AccountCreationView
} from '../../contracts/account-creation-contract.js'
import {
	workerAccountCreationView,
	workerTransactionEntryView,
	type WorkerTransactionEntryCommand,
	type WorkerTransactionEntryView,
	type WorkerAccountCreationView,
	type FinanceFormsObservation,
	type WorkerAccountCreationCommand
} from '../../contracts/worker-forms.js'

/** One SDK-bound workflow owner. Existing charts retain initialization, form policy and settlement. */
export function createFinanceFormsMachine(
	dependencies: Omit<Parameters<typeof createAccountCreationFormOptions>[0], 'observe'> & {
		navigation: ReturnType<typeof createWorkspaceNavigationMachine>
		archive: (accountId: string) => Promise<unknown>
		initialization: InputFrom<typeof workspaceInitialization>
		observe: () => FinanceFormsObservation
		db: Parameters<typeof createTransactionEntryFormOptions>[0]['db']
	}
) {
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
	const editTransaction = createScopedFormMachine(editOptions)
	const enterTransaction = createScopedFormMachine<
		TransactionSaveValues,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<typeof transactionOptions.availability>,
		SnapshotFrom<typeof transactionOptions.operation>
	>(transactionOptions)
	const createAccount = createScopedFormMachine<
		AccountFormValues,
		Account,
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationObservation,
		SnapshotFrom<typeof options.availability>,
		SnapshotFrom<typeof options.operation>
	>(options)
	type Input = { observation: FinanceFormsObservation; selectionRevision: number }
	type Context = Input & {
		navigation: NavigationReport | undefined
		archive: ReturnType<typeof selectAccountArchiveReport> | undefined
		initialization: OutputFrom<typeof workspaceInitialization> | undefined
		edit: TransactionEntryView | undefined
		editObservation: TransactionEntryObservation | undefined
		creation: AccountCreationView | undefined
		creationObservation: AccountCreationObservation | undefined
		transaction: TransactionEntryView | undefined
		transactionObservation: TransactionEntryObservation | undefined
	}
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			internalEvents: {
				CREATION_CLOSED: types(),
				TRANSACTION_CLOSED: types(),
				EDIT_CLOSED: types(),
				INITIALIZATION_CLOSED: types(),
				NAVIGATION_CLOSED: types(),
				ARCHIVE_CLOSED: types()
			},
			events: {
				OBSERVE: types<Input>(),
				NAVIGATION_STATUS: types<{ report: NavigationReport }>(),
				SELECT_WORKSPACE: types<{ workspaceId: string }>(),
				RETRY_NAVIGATION: types(),
				ARCHIVE_ACCOUNT: types<{ accountId: string }>(),
				ACCOUNT_CREATION: types<{ command: WorkerAccountCreationCommand }>(),
				TRANSACTION_ENTRY: types<{ command: WorkerTransactionEntryCommand }>(),
				TRANSACTION_EDIT: types<{ command: WorkerTransactionEntryCommand }>(),
				SHUTDOWN: types()
			},
			children: {
				navigation:
					types<
						import('xstate').ActorRefFrom<ReturnType<typeof createWorkspaceNavigationMachine>>
					>(),
				archive: types<import('xstate').ActorRefFrom<typeof archive>>(),
				initialization: types<import('xstate').ActorRefFrom<typeof workspaceInitialization>>(),
				edit: types<import('xstate').ActorRefFrom<typeof editTransaction>>(),
				creation: types<import('xstate').ActorRefFrom<typeof createAccount>>(),
				transaction: types<import('xstate').ActorRefFrom<typeof enterTransaction>>()
			}
		},
		actors: {
			createAccount,
			enterTransaction,
			editTransaction,
			workspaceInitialization,
			archive,
			navigation: dependencies.navigation
		}
	}).createMachine({
		id: 'finance-forms',
		initial: 'active',
		context: ({ input }) => ({
			...input,
			navigation: undefined,
			archive: undefined,
			initialization: undefined,
			edit: undefined,
			editObservation: undefined,
			creation: undefined,
			creationObservation: undefined,
			transaction: undefined,
			transactionObservation: undefined
		}),
		output: () => ({ outcome: 'closed' }),
		invoke: [
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
				id: 'initialization',
				src: 'workspaceInitialization',
				input: () => dependencies.initialization,
				onDone: ({ value, event }, enq) => {
					if (matchesState('closing', value)) enq.raise({ type: 'INITIALIZATION_CLOSED' })
					return { context: { initialization: event.output } }
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
									creation: selectScopedFormView<
										AccountFormValues,
										Account,
										AccountCreationReason,
										AccountCreationScope,
										AccountCreationObservation,
										SnapshotFrom<typeof options.availability>,
										SnapshotFrom<typeof options.operation>
									>(event.snapshot, options)
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
									transaction: selectScopedFormView<
										TransactionSaveValues,
										void,
										TransactionEntryReason,
										TransactionEntryScope,
										TransactionEntryObservation,
										SnapshotFrom<typeof transactionOptions.availability>,
										SnapshotFrom<typeof transactionOptions.operation>
									>(event.snapshot, transactionOptions)
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
				onSnapshot: ({ context, event }) =>
					selectScopedFormObservation(event.snapshot) === context.observation.edit
						? {
								context: {
									editObservation: context.observation.edit,
									edit: selectScopedFormView<
										TransactionSaveValues,
										void,
										TransactionEntryReason,
										TransactionEntryScope,
										TransactionEntryObservation,
										SnapshotFrom<typeof editOptions.availability>,
										SnapshotFrom<typeof editOptions.operation>
									>(event.snapshot, editOptions)
								}
							}
						: undefined,
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'EDIT_CLOSED' })
				},
				onError: { target: '.failed', context: { edit: undefined } }
			}
		],
		states: {
			active: {
				on: {
					NAVIGATION_STATUS: ({ context, event }) =>
						event.report.generation === context.observation.navigation.generation
							? { context: { navigation: event.report } }
							: undefined,
					SELECT_WORKSPACE: ({ event }, enq) =>
						enq.sendTo('navigation', { type: 'SELECT', workspaceId: event.workspaceId }),
					RETRY_NAVIGATION: (_, enq) => enq.sendTo('navigation', { type: 'RETRY' }),
					OBSERVE: ({ event }, enq) => {
						enq.sendTo('navigation', { type: 'OBSERVED', facts: event.observation.navigation })
						enq.sendTo('archive', { type: 'OBSERVE', observation: event.observation.archive })
						enq.sendTo('edit', { type: 'OBSERVE', observation: event.observation.edit })
						enq.sendTo('creation', { type: 'OBSERVE', observation: event.observation.creation })
						enq.sendTo('transaction', {
							type: 'OBSERVE',
							observation: event.observation.transaction
						})
						return {
							context: {
								observation: event.observation,
								selectionRevision: event.selectionRevision
							}
						}
					},
					ARCHIVE_ACCOUNT: ({ context, event }, enq) => {
						enq.sendTo('archive', { type: 'OBSERVE', observation: context.observation.archive })
						enq.sendTo('archive', { type: 'ARCHIVE', accountId: event.accountId })
					},
					ACCOUNT_CREATION: ({ context, event }, enq) => {
						enq.sendTo('creation', { type: 'OBSERVE', observation: context.observation.creation })
						enq.sendTo('creation', event.command)
					},
					TRANSACTION_EDIT: ({ context, event }, enq) => {
						enq.sendTo('edit', { type: 'OBSERVE', observation: context.observation.edit })
						enq.sendTo('edit', event.command)
					},
					TRANSACTION_ENTRY: ({ context, event }, enq) => {
						enq.sendTo('transaction', {
							type: 'OBSERVE',
							observation: context.observation.transaction
						})
						enq.sendTo('transaction', event.command)
					},
					SHUTDOWN: ({ self }, enq) => {
						const initialization = self.getSnapshot().children.initialization
						if (initialization?.getSnapshot().status === 'active')
							enq.sendTo(initialization, { type: 'SHUTDOWN' })
						enq.sendTo('navigation', { type: 'SHUTDOWN' })
						enq.sendTo('archive', { type: 'SHUTDOWN' })
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
					initialization: {
						initial: 'assessing',
						states: {
							assessing: {
								type: 'choice',
								choice: ({ context }) => ({ target: context.initialization ? 'closed' : 'waiting' })
							},
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
	const selectionRevision = snapshot.context.selectionRevision
	const result = snapshot.context.initialization
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
		!context.creation ||
		!context.transaction ||
		context.creationObservation !== context.observation.creation ||
		context.transactionObservation !== context.observation.transaction
	)
		return {
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
