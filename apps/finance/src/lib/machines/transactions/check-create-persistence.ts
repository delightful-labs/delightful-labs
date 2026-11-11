import { PersistedWriteRejectedError } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { z } from 'zod'
import { app } from '#lib/schema.js'
import { appCheckSchema } from '#lib/validation/checks.js'
import type { FormInterruption, FormSettlement } from '#lib/contracts/form-contract.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type CheckCreationDb = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
const requestSchema = z.strictObject({
	id: z.uuid(),
	values: appCheckSchema,
	mode: z.enum(['create', 'edit']).optional()
})
export type CheckCreationInput = z.infer<typeof requestSchema>
export type CheckCreationEvent = { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }
export type CheckCreationResult = {
	outcome: 'succeeded' | 'failed' | FormInterruption
	checkId: string
	settlement: FormSettlement
}
type Transaction = ReturnType<CheckCreationDb['beginTransaction']>
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing Check creation resource')
	return value
}
const validate = createAsyncLogic({
	run: ({ input }: { input: CheckCreationInput }) => Promise.resolve(requestSchema.safeParse(input))
})
const open = createAsyncLogic({
	run: ({ input }: { input: CheckCreationDb }) => Promise.resolve(input.beginTransaction())
})
const stage = createAsyncLogic({
	run: ({ input }: { input: { tx: Transaction; request: CheckCreationInput } }) => {
		input.tx.insert(
			app.checks,
			{
				...input.request.values,
				payerName: input.request.values.payerName ?? null,
				bankName: input.request.values.bankName ?? null,
				memoOnCheck: input.request.values.memoOnCheck ?? null
			},
			{ id: input.request.id }
		)
		return Promise.resolve()
	}
})
const update = createAsyncLogic({
	run: ({ input }: { input: { tx: Transaction; request: CheckCreationInput } }) => {
		input.tx.update(app.checks, input.request.id, {
			...input.request.values,
			payerName: input.request.values.payerName ?? null,
			bankName: input.request.values.bankName ?? null,
			memoOnCheck: input.request.values.memoOnCheck ?? null
		})
		return Promise.resolve()
	}
})
const commit = createAsyncLogic({
	run: ({ input }: { input: Transaction }) => Promise.resolve(input.commit())
})
const settle = createAsyncLogic({
	run: ({ input }: { input: OutputFrom<typeof commit> }) => input.wait({ tier: 'local' })
})
const rollback = createAsyncLogic({ run: ({ input }: { input: Transaction }) => input.rollback() })
type Context = {
	request: CheckCreationInput
	tx: Transaction | undefined
	handle: OutputFrom<typeof commit> | undefined
	settlement: FormSettlement
	result: CheckCreationResult | undefined
}

/** One attempt with a caller-owned stable ID; the staged save owner reconciles unknown results. */
export function createCheckCreationMachine(db: CheckCreationDb) {
	const actors = { validate, open, stage, update, commit, settle, rollback }
	const events0 = {
		CANCEL: types<EventPayload<CheckCreationEvent, 'CANCEL'>>(),
		INVALIDATE: types<EventPayload<CheckCreationEvent, 'INVALIDATE'>>(),
		SHUTDOWN: types<EventPayload<CheckCreationEvent, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['validate']>
				| import('xstate').OutputFrom<(typeof actors)['open']>
				| import('xstate').OutputFrom<(typeof actors)['stage']>
				| import('xstate').OutputFrom<(typeof actors)['update']>
				| import('xstate').OutputFrom<(typeof actors)['commit']>
				| import('xstate').OutputFrom<(typeof actors)['settle']>
				| import('xstate').OutputFrom<(typeof actors)['rollback']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<CheckCreationInput>(),
			output: types<CheckCreationResult>(),
			children: {
				validate: types<import('xstate').ActorRefFrom<(typeof actors)['validate']>>(),
				open: types<import('xstate').ActorRefFrom<(typeof actors)['open']>>(),
				stage: types<import('xstate').ActorRefFrom<(typeof actors)['stage']>>(),
				update: types<import('xstate').ActorRefFrom<(typeof actors)['update']>>(),
				commit: types<import('xstate').ActorRefFrom<(typeof actors)['commit']>>(),
				settle: types<import('xstate').ActorRefFrom<(typeof actors)['settle']>>(),
				rollback: types<import('xstate').ActorRefFrom<(typeof actors)['rollback']>>()
			}
		},
		actors,
		guards: {
			interrupted: (args: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'interrupted' } }, args.value)
		}
	})
	const terminal = (outcome: CheckCreationResult['outcome']) =>
		model.createStateConfig({
			type: 'final',
			entry: (args: { context: Context }) => {
				const { context } = args
				return {
					context: {
						result: {
							outcome,
							checkId: context.request.id,
							settlement: context.settlement
						},
						tx: undefined,
						handle: undefined
					}
				}
			}
		})
	return model.createMachine({
		id: 'check-create-persistence',
		initial: 'running',
		context: ({ input }) => ({
			request: input,
			tx: undefined,
			handle: undefined,
			settlement: 'notStarted',
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						on: {
							CANCEL: { target: '.interrupted.cancelled' },
							INVALIDATE: { target: '.interrupted.scopeChanged' },
							SHUTDOWN: { target: '.interrupted.closed' }
						},
						states: {
							active: {},
							interrupted: {
								initial: 'cancelled',
								states: {
									cancelled: { on: { CANCEL: {} } },
									scopeChanged: { on: { CANCEL: {}, INVALIDATE: {} } },
									closed: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {} } }
								}
							}
						}
					},
					flow: {
						initial: 'validating',
						states: {
							validating: {
								invoke: {
									src: 'validate',
									input: ({ context }) => context.request,
									onDone: (args) => {
										const { event } = args
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'finishing' }
										}
										if (event.output.success) {
											return {
												target: 'opening',
												context: {
													request: event.output.success ? event.output.data : args.context.request
												}
											}
										}
										return { target: 'finishing' }
									},
									onError: { target: 'finishing' }
								}
							},
							opening: {
								invoke: {
									src: 'open',
									input: () => db,
									onDone: (args) => {
										const { event } = args
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack', context: { tx: event.output } }
										}
										if (args.context.request.mode === 'edit') {
											return { target: 'updating', context: { tx: event.output } }
										}
										return { target: 'staging', context: { tx: event.output } }
									},
									onError: { target: 'finishing' }
								}
							},
							staging: {
								invoke: {
									src: 'stage',
									input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
									onDone: (args) => {
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack' }
										}
										return { target: 'committing' }
									},
									onError: { target: 'rollingBack' }
								}
							},
							updating: {
								invoke: {
									src: 'update',
									input: ({ context }) => ({ tx: required(context.tx), request: context.request }),
									onDone: (args) => {
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
											return { target: 'rollingBack' }
										}
										return { target: 'committing' }
									},
									onError: { target: 'rollingBack' }
								}
							},
							committing: {
								entry: () => {
									return { context: { settlement: 'unknown' } }
								},
								invoke: {
									src: 'commit',
									input: ({ context }) => required(context.tx),
									onDone: (args) => {
										return { target: 'settling', context: { handle: args.event.output } }
									},
									onError: (args) => {
										if (args.event.error instanceof PersistedWriteRejectedError) {
											return { target: 'rollingBack', context: { settlement: 'rejected' } }
										}
										return { target: 'rollingBack' }
									}
								}
							},
							settling: {
								invoke: {
									src: 'settle',
									input: ({ context }) => required(context.handle),
									onDone: () => {
										return { target: 'finishing', context: { settlement: 'locallyPersisted' } }
									},
									onError: (args) => {
										if (args.event.error instanceof PersistedWriteRejectedError) {
											return { target: 'rollingBack', context: { settlement: 'rejected' } }
										}
										return { target: 'rollingBack' }
									}
								}
							},
							rollingBack: {
								invoke: {
									src: 'rollback',
									input: ({ context }) => required(context.tx),
									onDone: (args) => {
										const { context } = args
										return {
											target: 'finishing',
											context: {
												settlement:
													context.settlement === 'rejected' ||
													(args.event.output && context.settlement === 'notStarted')
														? 'rejected'
														: context.settlement === 'notStarted'
															? 'unknown'
															: context.settlement
											}
										}
									},
									onError: (args) => {
										return {
											target: 'finishing',
											context: {
												settlement: args.context.settlement === 'rejected' ? 'rejected' : 'unknown'
											}
										}
									}
								}
							},
							finishing: {
								always: (args) => {
									if (
										matchesState({ running: { control: { interrupted: 'closed' } } }, args.value)
									) {
										return { target: '#check-create-persistence.closed' }
									}
									if (
										matchesState(
											{ running: { control: { interrupted: 'scopeChanged' } } },
											args.value
										)
									) {
										return { target: '#check-create-persistence.scopeChanged' }
									}
									if (
										matchesState({ running: { control: { interrupted: 'cancelled' } } }, args.value)
									) {
										return { target: '#check-create-persistence.cancelled' }
									}
									if (args.context.settlement === 'locallyPersisted') {
										return { target: '#check-create-persistence.succeeded' }
									}
									return { target: '#check-create-persistence.failed' }
								}
							}
						}
					}
				}
			},
			succeeded: terminal('succeeded'),
			failed: terminal('failed'),
			cancelled: terminal('cancelled'),
			scopeChanged: terminal('scopeChanged'),
			closed: terminal('closed')
		}
	})
}
