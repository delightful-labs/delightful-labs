import { setup, types, createAsyncLogic, matchesState, type SnapshotFrom } from 'xstate'
import { accountOrderMachine, orderAccounts, selectAccountOrderView } from './account-order.js'
import type {
	AccountOrderStorage,
	AccountOrderObservation,
	WorkerAccountOrderCommand
} from '../../contracts/worker-forms.js'
type Editor = ReturnType<typeof selectAccountOrderView>
type Write = { key: string; ids: readonly string[]; revision: number }
type Input = { observation: AccountOrderObservation }
type Context = Input & {
	key: string | null
	preferred: readonly string[]
	editor: Editor | undefined
	savedRevision: number
	writing: Write | undefined
}
function ordered(observation: AccountOrderObservation, preferred: readonly string[]) {
	return orderAccounts(
		observation.ids.map((id) => ({ id })),
		preferred
	).map((row) => row.id)
}
export function createAccountOrderPersistenceMachine(storage: AccountOrderStorage) {
	const read = createAsyncLogic({ run: ({ input }: { input: string }) => storage.read(input) })
	const write = createAsyncLogic({
		run: ({ input }: { input: Write }) => storage.write(input.key, input.ids)
	})
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			events: {
				OBSERVE: types<Input>(),
				COMMAND: types<{ command: WorkerAccountOrderCommand }>(),
				SHUTDOWN: types()
			},
			children: { editor: types<import('xstate').ActorRefFrom<typeof accountOrderMachine>>() }
		},
		actors: { editor: accountOrderMachine, read, write }
	}).createMachine({
		id: 'persisted-account-order',
		initial: 'assessing',
		context: ({ input }) => ({
			...input,
			key: input.observation.key,
			preferred: [],
			editor: undefined,
			savedRevision: 0,
			writing: undefined
		}),
		invoke: {
			id: 'editor',
			src: 'editor',
			onSnapshot: ({ context, event, value }) => {
				const editor = selectAccountOrderView(event.snapshot)
				if (
					matchesState('ready', value) &&
					editor.revision > context.savedRevision &&
					context.key &&
					context.key === context.observation.key
				)
					return {
						target: '.saving',
						context: {
							editor,
							preferred: editor.ids,
							writing: { key: context.key, ids: editor.ids, revision: editor.revision }
						}
					}
				return {
					context: {
						editor,
						...(editor.revision > context.savedRevision ? { preferred: editor.ids } : {})
					}
				}
			},
			onError: { target: '.failed' }
		},
		on: {
			SHUTDOWN: { target: '.closed' },
			COMMAND: ({ context, event, value }, enq) => {
				if (
					(matchesState('ready', value) ||
						matchesState('unavailable', value) ||
						matchesState({ saving: 'active' }, value)) &&
					context.key === context.observation.key
				)
					enq.sendTo('editor', event.command)
			},
			OBSERVE: ({ context, event, value }, enq) => {
				if (
					matchesState({ reading: 'closing' }, value) ||
					matchesState({ saving: 'closing' }, value) ||
					matchesState('closed', value)
				)
					return
				if (event.observation.key === context.key) {
					enq.sendTo('editor', {
						type: 'OBSERVE',
						ids: ordered(event.observation, context.preferred)
					})
					return { context: { observation: event.observation } }
				}
				if (matchesState('reading', value) || matchesState('saving', value))
					return { context: { observation: event.observation } }
				return {
					target: event.observation.key ? '.reading' : '.waiting',
					context: {
						observation: event.observation,
						key: event.observation.key,
						savedRevision: context.editor?.revision ?? context.savedRevision,
						preferred: [],
						editor: undefined
					}
				}
			}
		},
		states: {
			assessing: {
				type: 'choice',
				choice: ({ context }) => ({ target: context.key ? 'reading' : 'waiting' })
			},
			waiting: {},
			reading: {
				initial: 'active',
				states: { active: {}, closing: { on: { SHUTDOWN: {}, COMMAND: {}, OBSERVE: {} } } },
				on: { SHUTDOWN: { target: '.closing' } },
				invoke: {
					src: 'read',
					input: ({ context }) => {
						if (!context.key) throw new Error('Missing account order key')
						return context.key
					},
					onDone: ({ context, event, value }, enq) => {
						if (matchesState({ reading: 'closing' }, value)) return { target: 'closed' }
						if (context.key !== context.observation.key)
							return {
								target: context.observation.key ? 'reading' : 'waiting',
								reenter: true,
								context: { key: context.observation.key, preferred: [], editor: undefined }
							}
						enq.sendTo('editor', { type: 'RESET', ids: ordered(context.observation, event.output) })
						return {
							target: 'ready',
							context: {
								preferred: event.output,
								savedRevision: context.editor?.revision ?? context.savedRevision,
								editor: undefined
							}
						}
					},
					onError: ({ context, value }, enq) => {
						if (matchesState({ reading: 'closing' }, value)) return { target: 'closed' }
						if (context.key !== context.observation.key)
							return {
								target: context.observation.key ? 'reading' : 'waiting',
								reenter: true,
								context: { key: context.observation.key, editor: undefined, preferred: [] }
							}
						enq.sendTo('editor', { type: 'RESET', ids: context.observation.ids })
						return {
							target: 'unavailable',
							context: {
								preferred: [],
								savedRevision: context.editor?.revision ?? context.savedRevision,
								editor: undefined
							}
						}
					}
				}
			},
			ready: {},
			unavailable: {},
			saving: {
				initial: 'active',
				states: { active: {}, closing: { on: { SHUTDOWN: {}, COMMAND: {}, OBSERVE: {} } } },
				on: { SHUTDOWN: { target: '.closing' } },
				invoke: {
					src: 'write',
					input: ({ context }) => {
						if (!context.writing) throw new Error('Missing account order write')
						return context.writing
					},
					onDone: ({ context, value }) => {
						if (
							context.editor &&
							context.key &&
							context.editor.revision > (context.writing?.revision ?? 0)
						)
							return {
								target: matchesState({ saving: 'closing' }, value) ? 'saving.closing' : 'saving',
								reenter: true,
								context: {
									writing: {
										key: context.key,
										ids: context.editor.ids,
										revision: context.editor.revision
									}
								}
							}
						if (matchesState({ saving: 'closing' }, value)) return { target: 'closed' }
						if (context.key !== context.observation.key)
							return {
								target: context.observation.key ? 'reading' : 'waiting',
								context: {
									key: context.observation.key,
									preferred: [],
									savedRevision: context.editor?.revision ?? context.savedRevision,
									editor: undefined,
									writing: undefined
								}
							}
						return {
							target: 'ready',
							context: {
								savedRevision: context.writing?.revision ?? context.savedRevision,
								writing: undefined
							}
						}
					},
					onError: ({ context, value }) => {
						if (matchesState({ saving: 'closing' }, value)) return { target: 'closed' }
						if (context.key !== context.observation.key)
							return {
								target: context.observation.key ? 'reading' : 'waiting',
								context: {
									key: context.observation.key,
									savedRevision: context.editor?.revision ?? context.savedRevision,
									preferred: [],
									editor: undefined,
									writing: undefined
								}
							}
						return {
							target: 'unavailable',
							context: {
								writing: undefined,
								savedRevision: context.editor?.revision ?? context.savedRevision
							}
						}
					}
				}
			},
			failed: { on: { SHUTDOWN: {}, OBSERVE: {}, COMMAND: {} } },
			closed: { type: 'final' }
		}
	})
}
export function selectPersistedAccountOrder(
	snapshot: SnapshotFrom<ReturnType<typeof createAccountOrderPersistenceMachine>>
) {
	const { context } = snapshot
	return snapshot.status === 'active' &&
		(snapshot.matches('ready') ||
			snapshot.matches('unavailable') ||
			snapshot.matches({ saving: 'active' })) &&
		context.key === context.observation.key &&
		context.editor
		? { key: context.key, view: context.editor }
		: undefined
}
