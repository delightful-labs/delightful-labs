import {
	createCategoryManagementFormOptions,
	createTagManagementFormOptions
} from '../management/classification-forms.js'
import {
	workerCategoryFormView,
	workerTagFormView,
	workerClassificationArchiveView,
	workerClassificationForms,
	type ClassificationForm,
	type WorkerClassificationForms
} from '../../contracts/worker-forms.js'
import type { ManagementObservation } from '../../contracts/management-contract.js'
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
	type WorkerTransactionEntryCommand,
	type WorkerTransactionEntryView,
	type WorkerAccountCreationView,
	type FinanceFormsObservation,
	type WorkerAccountCreationCommand
} from '../../contracts/worker-forms.js'

/** One SDK-bound workflow owner. Existing charts retain initialization, form policy and settlement. */
export function createFinanceFormsMachine(
	dependencies: Omit<Parameters<typeof createAccountCreationFormOptions>[0], 'observe'> & {
		accountOrderStorage: AccountOrderStorage
		classification: {
			categories: ReturnType<typeof createCategoryManagementFormOptions>
			tags: ReturnType<typeof createTagManagementFormOptions>
		}
		navigation: ReturnType<typeof createWorkspaceNavigationMachine>
		archive: (accountId: string) => Promise<unknown>
		initialization: InputFrom<typeof workspaceInitialization>
		observe: () => FinanceFormsObservation
		db: Parameters<typeof createTransactionEntryFormOptions>[0]['db']
	}
) {
	const createCategory = createScopedFormMachine(dependencies.classification.categories.create)
	const archiveCategory = createScopedFormMachine(dependencies.classification.categories.archive)
	const createTag = createScopedFormMachine(dependencies.classification.tags.create)
	const archiveTag = createScopedFormMachine(dependencies.classification.tags.archive)
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
	const editTransaction = createScopedFormMachine(editOptions)
	const enterTransaction = createScopedFormMachine(transactionOptions)
	const createAccount = createScopedFormMachine(options)
	type Input = { observation: FinanceFormsObservation; selectionRevision: number }
	type Context = Input & {
		createCategory: WorkerClassificationForms['createCategory'] | undefined
		createCategoryObservation: ManagementObservation | undefined
		archiveCategory: WorkerClassificationForms['archiveCategory'] | undefined
		archiveCategoryObservation: ManagementObservation | undefined
		createTag: WorkerClassificationForms['createTag'] | undefined
		createTagObservation: ManagementObservation | undefined
		archiveTag: WorkerClassificationForms['archiveTag'] | undefined
		archiveTagObservation: ManagementObservation | undefined

		order: ReturnType<typeof selectPersistedAccountOrder>
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
				CREATECATEGORY_CLOSED: types(),
				ARCHIVECATEGORY_CLOSED: types(),
				CREATETAG_CLOSED: types(),
				ARCHIVETAG_CLOSED: types(),

				CREATION_CLOSED: types(),
				TRANSACTION_CLOSED: types(),
				EDIT_CLOSED: types(),
				INITIALIZATION_CLOSED: types(),
				NAVIGATION_CLOSED: types(),
				ARCHIVE_CLOSED: types(),
				ORDER_CLOSED: types()
			},
			events: {
				CLASSIFICATION: types<{
					form: ClassificationForm
					command: WorkerAccountCreationCommand
				}>(),
				OBSERVE: types<Input>(),
				NAVIGATION_STATUS: types<{ report: NavigationReport }>(),
				SELECT_WORKSPACE: types<{ workspaceId: string }>(),
				NAVIGATE: types<{ destination: string; replace: boolean }>(),
				RETRY_NAVIGATION: types(),
				ARCHIVE_ACCOUNT: types<{ accountId: string }>(),
				ACCOUNT_ORDER: types<{ command: WorkerAccountOrderCommand }>(),
				ACCOUNT_CREATION: types<{ command: WorkerAccountCreationCommand }>(),
				TRANSACTION_ENTRY: types<{ command: WorkerTransactionEntryCommand }>(),
				TRANSACTION_EDIT: types<{ command: WorkerTransactionEntryCommand }>(),
				SHUTDOWN: types()
			},
			children: {
				createCategory: types<import('xstate').ActorRefFrom<typeof createCategory>>(),
				archiveCategory: types<import('xstate').ActorRefFrom<typeof archiveCategory>>(),
				createTag: types<import('xstate').ActorRefFrom<typeof createTag>>(),
				archiveTag: types<import('xstate').ActorRefFrom<typeof archiveTag>>(),

				order: types<import('xstate').ActorRefFrom<typeof accountOrder>>(),
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
			createCategory,
			archiveCategory,
			createTag,
			archiveTag,

			accountOrder,
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
			createCategory: undefined,
			createCategoryObservation: undefined,
			archiveCategory: undefined,
			archiveCategoryObservation: undefined,
			createTag: undefined,
			createTagObservation: undefined,
			archiveTag: undefined,
			archiveTagObservation: undefined,

			order: undefined,
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
				id: 'createCategory',
				src: 'createCategory',
				input: ({ context }) => context.observation.classification,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.classification)
						return
					const view = workerCategoryFormView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.classification.categories.create)
					)
					return view.success
						? {
								context: {
									createCategory: view.data,
									createCategoryObservation: context.observation.classification
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'CREATECATEGORY_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'archiveCategory',
				src: 'archiveCategory',
				input: ({ context }) => context.observation.classification,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.classification)
						return
					const view = workerClassificationArchiveView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.classification.categories.archive)
					)
					return view.success
						? {
								context: {
									archiveCategory: view.data,
									archiveCategoryObservation: context.observation.classification
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'ARCHIVECATEGORY_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'createTag',
				src: 'createTag',
				input: ({ context }) => context.observation.classification,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.classification)
						return
					const view = workerTagFormView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.classification.tags.create)
					)
					return view.success
						? {
								context: {
									createTag: view.data,
									createTagObservation: context.observation.classification
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'CREATETAG_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'archiveTag',
				src: 'archiveTag',
				input: ({ context }) => context.observation.classification,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.classification)
						return
					const view = workerClassificationArchiveView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.classification.tags.archive)
					)
					return view.success
						? {
								context: {
									archiveTag: view.data,
									archiveTagObservation: context.observation.classification
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'ARCHIVETAG_CLOSED' })
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
				onSnapshot: ({ context, event }) =>
					selectScopedFormObservation(event.snapshot) === context.observation.edit
						? {
								context: {
									editObservation: context.observation.edit,
									edit: selectScopedFormView(event.snapshot, editOptions)
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
					NAVIGATE: ({ event }, enq) => enq.sendTo('navigation', event),
					RETRY_NAVIGATION: (_, enq) => enq.sendTo('navigation', { type: 'RETRY' }),
					OBSERVE: ({ context, event }, enq) => {
						enq.sendTo('navigation', { type: 'OBSERVED', facts: event.observation.navigation })
						enq.sendTo('archive', { type: 'OBSERVE', observation: event.observation.archive })
						enq.sendTo('order', { type: 'OBSERVE', observation: event.observation.order })
						if (event.observation.navigation.pathname !== context.observation.navigation.pathname) {
							enq.sendTo('createCategory', { type: 'RESET' })
							enq.sendTo('archiveCategory', { type: 'RESET' })
							enq.sendTo('createTag', { type: 'RESET' })
							enq.sendTo('archiveTag', { type: 'RESET' })
						}
						enq.sendTo('createCategory', {
							type: 'OBSERVE',
							observation: event.observation.classification
						})
						enq.sendTo('archiveCategory', {
							type: 'OBSERVE',
							observation: event.observation.classification
						})
						enq.sendTo('createTag', {
							type: 'OBSERVE',
							observation: event.observation.classification
						})
						enq.sendTo('archiveTag', {
							type: 'OBSERVE',
							observation: event.observation.classification
						})

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
					ARCHIVE_ACCOUNT: ({ event }, enq) => {
						enq.sendTo('archive', { type: 'ARCHIVE', accountId: event.accountId })
					},
					CLASSIFICATION: ({ event }, enq) => {
						enq.sendTo(event.form, event.command)
					},
					ACCOUNT_ORDER: ({ event }, enq) => {
						enq.sendTo('order', { type: 'COMMAND', command: event.command })
					},
					ACCOUNT_CREATION: ({ event }, enq) => {
						enq.sendTo('creation', event.command)
					},
					TRANSACTION_EDIT: ({ event }, enq) => {
						enq.sendTo('edit', event.command)
					},
					TRANSACTION_ENTRY: ({ event }, enq) => {
						enq.sendTo('transaction', event.command)
					},
					SHUTDOWN: ({ self }, enq) => {
						const initialization = self.getSnapshot().children.initialization
						if (initialization?.getSnapshot().status === 'active')
							enq.sendTo(initialization, { type: 'SHUTDOWN' })
						enq.sendTo('navigation', { type: 'SHUTDOWN' })
						enq.sendTo('archive', { type: 'SHUTDOWN' })
						enq.sendTo('order', { type: 'SHUTDOWN' })
						enq.sendTo('createCategory', { type: 'SHUTDOWN' })
						enq.sendTo('archiveCategory', { type: 'SHUTDOWN' })
						enq.sendTo('createTag', { type: 'SHUTDOWN' })
						enq.sendTo('archiveTag', { type: 'SHUTDOWN' })

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
					createCategory: {
						initial: 'waiting',
						states: {
							waiting: { on: { CREATECATEGORY_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					archiveCategory: {
						initial: 'waiting',
						states: {
							waiting: { on: { ARCHIVECATEGORY_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					createTag: {
						initial: 'waiting',
						states: {
							waiting: { on: { CREATETAG_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					archiveTag: {
						initial: 'waiting',
						states: {
							waiting: { on: { ARCHIVETAG_CLOSED: { target: 'closed' } } },
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
	const projected = workerClassificationForms.safeParse({
		createCategory: c.createCategory,
		archiveCategory: c.archiveCategory,
		createTag: c.createTag,
		archiveTag: c.archiveTag
	})
	const classification =
		c.createCategoryObservation === c.observation.classification &&
		c.archiveCategoryObservation === c.observation.classification &&
		c.createTagObservation === c.observation.classification &&
		c.archiveTagObservation === c.observation.classification &&
		projected.success
			? projected.data
			: null
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
		!context.creation ||
		!context.transaction ||
		context.creationObservation !== context.observation.creation ||
		context.transactionObservation !== context.observation.transaction
	)
		return {
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
