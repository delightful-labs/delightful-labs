import { setup, types, type SnapshotFrom } from 'xstate'
import { createAccountCreationFormOptions } from '../accounts/account-creation-access.js'
import {
	createScopedFormMachine,
	selectScopedFormView,
	selectScopedFormObservation
} from '../forms/scoped-form.js'
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
	type WorkerAccountCreationCommand
} from '../../contracts/worker-forms.js'

/** One SDK-bound forms owner. Existing form actors retain all policy, validation and settlement. */
export function createFinanceFormsMachine(
	dependencies: Parameters<typeof createAccountCreationFormOptions>[0]
) {
	const options = createAccountCreationFormOptions(dependencies)
	const createAccount = createScopedFormMachine<
		AccountFormValues,
		Account,
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationObservation,
		SnapshotFrom<typeof options.availability>,
		SnapshotFrom<typeof options.operation>
	>(options)
	type Input = { observation: AccountCreationObservation; selectionRevision: number }
	type Context = Input & {
		creation: AccountCreationView | undefined
		creationObservation: AccountCreationObservation | undefined
	}
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			events: {
				OBSERVE: types<Input>(),
				ACCOUNT_CREATION: types<{ command: WorkerAccountCreationCommand }>(),
				SHUTDOWN: types()
			},
			children: { creation: types<import('xstate').ActorRefFrom<typeof createAccount>>() }
		},
		actors: { createAccount }
	}).createMachine({
		id: 'finance-forms',
		initial: 'active',
		context: ({ input }) => ({ ...input, creation: undefined, creationObservation: undefined }),
		output: () => ({ outcome: 'closed' }),
		invoke: {
			id: 'creation',
			src: 'createAccount',
			input: ({ context }) => context.observation,
			onSnapshot: ({ context, event }) =>
				selectScopedFormObservation(event.snapshot) === context.observation
					? {
							context: {
								creationObservation: context.observation,
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
			onDone: ({ value }) => ({ target: value === 'closing' ? '.closed' : '.failed' }),
			onError: { target: '.failed', context: { creation: undefined } }
		},
		states: {
			active: {
				on: {
					OBSERVE: ({ event }, enq) => {
						enq.sendTo('creation', { type: 'OBSERVE', observation: event.observation })
						return {
							context: {
								observation: event.observation,
								selectionRevision: event.selectionRevision
							}
						}
					},
					ACCOUNT_CREATION: ({ context, event }, enq) => {
						enq.sendTo('creation', { type: 'OBSERVE', observation: context.observation })
						enq.sendTo('creation', event.command)
					},
					SHUTDOWN: (_, enq) => {
						enq.sendTo('creation', { type: 'SHUTDOWN' })
						return { target: 'closing' }
					}
				}
			},
			closing: { on: { SHUTDOWN: {} } },
			failed: { on: { SHUTDOWN: {} } },
			closed: { type: 'final' }
		}
	})
}

export function selectFinanceFormsView(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceFormsMachine>>
) {
	const selectionRevision = snapshot.context.selectionRevision
	if (snapshot.status !== 'active' || snapshot.matches('failed'))
		return { selectionRevision, status: 'failed', creation: null } satisfies {
			selectionRevision: number
			status: 'failed'
			creation: null
		}
	if (
		!snapshot.context.creation ||
		snapshot.context.creationObservation !== snapshot.context.observation
	)
		return { selectionRevision, status: 'loading', creation: null } satisfies {
			selectionRevision: number
			status: 'loading'
			creation: null
		}
	const decoded = workerAccountCreationView.safeParse(snapshot.context.creation)
	return decoded.success
		? ({ selectionRevision, status: 'ready', creation: decoded.data } satisfies {
				selectionRevision: number
				status: 'ready'
				creation: typeof decoded.data
			})
		: ({ selectionRevision, status: 'failed', creation: null } satisfies {
				selectionRevision: number
				status: 'failed'
				creation: null
			})
}
