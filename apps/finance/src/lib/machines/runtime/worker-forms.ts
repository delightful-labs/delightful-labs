import { setup, types, matchesState, type SnapshotFrom } from 'xstate'
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

/** One SDK-bound forms owner. Existing form actors retain all policy, validation and settlement. */
export function createFinanceFormsMachine(
	dependencies: Omit<Parameters<typeof createAccountCreationFormOptions>[0], 'observe'> & {
		observe: () => FinanceFormsObservation
		db: Parameters<typeof createTransactionEntryFormOptions>[0]['db']
	}
) {
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
				EDIT_CLOSED: types()
			},
			events: {
				OBSERVE: types<Input>(),
				ACCOUNT_CREATION: types<{ command: WorkerAccountCreationCommand }>(),
				TRANSACTION_ENTRY: types<{ command: WorkerTransactionEntryCommand }>(),
				TRANSACTION_EDIT: types<{ command: WorkerTransactionEntryCommand }>(),
				SHUTDOWN: types()
			},
			children: {
				edit: types<import('xstate').ActorRefFrom<typeof editTransaction>>(),
				creation: types<import('xstate').ActorRefFrom<typeof createAccount>>(),
				transaction: types<import('xstate').ActorRefFrom<typeof enterTransaction>>()
			}
		},
		actors: { createAccount, enterTransaction, editTransaction }
	}).createMachine({
		id: 'finance-forms',
		initial: 'active',
		context: ({ input }) => ({
			...input,
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
					OBSERVE: ({ event }, enq) => {
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
					SHUTDOWN: (_, enq) => {
						enq.sendTo('edit', { type: 'SHUTDOWN' })
						enq.sendTo('creation', { type: 'SHUTDOWN' })
						enq.sendTo('transaction', { type: 'SHUTDOWN' })
						return { target: 'closing' }
					}
				}
			},
			closing: {
				type: 'parallel',
				on: { SHUTDOWN: {} },
				onDone: { target: 'closed' },
				states: {
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

type FormsView = { selectionRevision: number } & (
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
	const selectionRevision = snapshot.context.selectionRevision
	if (snapshot.status !== 'active' || snapshot.matches('failed'))
		return { selectionRevision, status: 'failed', creation: null, transaction: null, edit: null }
	const { context } = snapshot
	if (
		!context.edit ||
		context.editObservation !== context.observation.edit ||
		!context.creation ||
		!context.transaction ||
		context.creationObservation !== context.observation.creation ||
		context.transactionObservation !== context.observation.transaction
	)
		return { selectionRevision, status: 'loading', creation: null, transaction: null, edit: null }
	const creation = workerAccountCreationView.safeParse(context.creation)
	const transaction = workerTransactionEntryView.safeParse(context.transaction)
	const edit = workerTransactionEntryView.safeParse(context.edit)
	return creation.success && transaction.success && edit.success
		? {
				selectionRevision,
				status: 'ready',
				creation: creation.data,
				transaction: transaction.data,
				edit: edit.data
			}
		: { selectionRevision, status: 'failed', creation: null, transaction: null, edit: null }
}
