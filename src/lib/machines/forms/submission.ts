import {
	matchesState,
	type StateValue,
	types,
	createAsyncLogic,
	setup,
	type ActorLogic,
	type ActorRef,
	type Snapshot
} from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import { formInterruptionResult } from '../../contracts/scoped-form.js'
import type {
	FormChildEvent,
	FormIssue,
	FormSchema,
	FormInterruption as _FormInterruption,
	FormObservation,
	FormOperationInput,
	FormOperationResult,
	FormRequest,
	FormResult,
	FormSubmissionProgressEvent
} from '../../contracts/scoped-form.js'
export type ScopedFormSubmissionInput<Scope, Observation> = {
	request: FormRequest<Scope>
	observation: FormObservation<Observation>
	recipient?: ActorRef<Snapshot<unknown>, FormSubmissionProgressEvent>
}
export type ScopedFormOperationLogic<
	Values,
	Scope,
	Observation,
	OperationSnapshot extends Snapshot<unknown>
> = ActorLogic<
	OperationSnapshot,
	FormChildEvent<Observation>,
	FormOperationInput<Values, Scope, Observation>
>
export function createScopedFormSubmissionMachine<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
>(options: {
	schema: FormSchema<Values>
	/** Pure normalization; undefined distinguishes an unexpected validation failure. */
	validationIssues: (error: unknown) => readonly FormIssue[] | undefined
	operation: ScopedFormOperationLogic<Values, Scope, Observation, OperationSnapshot>
}) {
	type Context = Omit<
		ScopedFormSubmissionInput<Scope, Observation>,
		'observation' | 'recipient'
	> & {
		recipient: ActorRef<Snapshot<unknown>, FormSubmissionProgressEvent> | undefined
		observation: FormObservation<Observation> | undefined
		validated:
			| {
					value: Values
			  }
			| undefined
		result: FormResult<Result, Reason> | undefined
	}
	type Event = FormChildEvent<Observation>
	const actors = {
		validate: createAsyncLogic<Values, unknown>({
			run: async ({ input }) => options.schema.parseAsync(input)
		}),
		operation: options.operation
	}
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				OBSERVE: types<EventPayload<Event, 'OBSERVE'>>()
			},
			input: types<ScopedFormSubmissionInput<Scope, Observation>>(),
			output: types<FormResult<Result, Reason>>()
		},
		actors,
		guards: {
			closing: ({ value }: { value: StateValue }) => matchesState({ validating: 'closing' }, value),
			invalidated: ({ value }: { value: StateValue }) =>
				matchesState({ validating: 'invalidated' }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ validating: 'cancelling' }, value)
		}
	})
	const publishProgress = (progress: FormSubmissionProgressEvent['progress']) =>
		workflow.createStateConfig({
			entry: ({ context }, enq) => {
				if (context.recipient)
					enq.sendTo(context.recipient, {
						type: 'FORM_SUBMISSION_PROGRESS',
						requestId: context.request.id,
						scopeRevision: context.request.scopeRevision,
						progress
					})
			}
		}).entry

	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof workflow.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		succeeded: (args, _enq) => {
			return {
				context: {
					request: { ...args.context.request, values: undefined, checkpoint: undefined },
					validated: undefined,
					recipient: undefined,
					observation: undefined
				} satisfies Partial<Context>
			}
		},
		partial: (args, _enq) => {
			return {
				context: {
					request: { ...args.context.request, values: undefined, checkpoint: undefined },
					validated: undefined,
					recipient: undefined,
					observation: undefined
				} satisfies Partial<Context>
			}
		},
		denied: (args, _enq) => {
			return {
				context: {
					request: { ...args.context.request, values: undefined, checkpoint: undefined },
					validated: undefined,
					recipient: undefined,
					observation: undefined
				} satisfies Partial<Context>
			}
		},
		unavailable: (args, _enq) => {
			return {
				context: {
					request: { ...args.context.request, values: undefined, checkpoint: undefined },
					validated: undefined,
					recipient: undefined,
					observation: undefined
				} satisfies Partial<Context>
			}
		},
		invalid: (args, _enq) => {
			return {
				context: {
					request: { ...args.context.request, values: undefined, checkpoint: undefined },
					validated: undefined,
					recipient: undefined,
					observation: undefined
				} satisfies Partial<Context>
			}
		},
		failed: (args, _enq) => {
			return {
				context: {
					request: { ...args.context.request, values: undefined, checkpoint: undefined },
					validated: undefined,
					recipient: undefined,
					observation: undefined
				} satisfies Partial<Context>
			}
		},
		scopeChanged: (args, _enq) => {
			let context = args.context
			let patch = {}
			patch = {
				...patch,
				result: context.result ?? { outcome: 'scopeChanged', settlement: 'notStarted' }
			}
			context = { ...args.context, ...patch }
			patch = {
				...patch,
				request: { ...context.request, values: undefined, checkpoint: undefined },
				validated: undefined,
				recipient: undefined,
				observation: undefined
			}
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		},
		cancelled: (args, _enq) => {
			let context = args.context
			let patch = {}
			patch = {
				...patch,
				result: context.result ?? { outcome: 'cancelled', settlement: 'notStarted' }
			}
			context = { ...args.context, ...patch }
			patch = {
				...patch,
				request: { ...context.request, values: undefined, checkpoint: undefined },
				validated: undefined,
				recipient: undefined,
				observation: undefined
			}
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		},
		closed: (args, _enq) => {
			let context = args.context
			let patch = {}
			patch = {
				...patch,
				result: context.result ?? { outcome: 'closed', settlement: 'notStarted' }
			}
			context = { ...args.context, ...patch }
			patch = {
				...patch,
				request: { ...context.request, values: undefined, checkpoint: undefined },
				validated: undefined,
				recipient: undefined,
				observation: undefined
			}
			context = { ...args.context, ...patch }
			return { context: patch satisfies Partial<Context> }
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>
	const complete = createFinalTransitions<
		Context,
		CompletionArgs,
		CompletionQueue,
		keyof typeof finalizers
	>(finalizers)

	return workflow.createMachine({
		id: 'scoped-form-submission',
		initial: 'validating',
		context: ({ input }) => ({
			...input,
			recipient: input.recipient,
			validated: undefined,
			result: undefined
		}),
		output: ({ context }): FormResult<Result, Reason> =>
			context.result ?? { outcome: 'failed', code: 'unexpected', settlement: 'unknown' },
		states: {
			validating: {
				entry: publishProgress('validating'),
				initial: 'pending',
				tags: ['validating'],
				invoke: workflow.createInvoke<typeof actors.validate, Context>({
					src: actors.validate,
					input: ({ context }: { context: Context }) => context.request.values,
					onDone: (args, enq) => {
						if (matchesState({ validating: 'closing' }, args.value)) {
							{
								return complete('closed', args, enq, { target: 'closed' })
							}
						}
						if (matchesState({ validating: 'invalidated' }, args.value)) {
							{
								return complete('scopeChanged', args, enq, { target: 'scopeChanged' })
							}
						}
						if (matchesState({ validating: 'cancelling' }, args.value)) {
							{
								return complete('cancelled', args, enq, { target: 'cancelled' })
							}
						}
						return {
							target: 'admittingOperation',
							context: { validated: { value: args.event.output } } satisfies Partial<Context>
						}
					},
					onError: (args, enq) => {
						if (matchesState({ validating: 'closing' }, args.value)) {
							{
								return complete('closed', args, enq, { target: 'closed' })
							}
						}
						if (matchesState({ validating: 'invalidated' }, args.value)) {
							{
								return complete('scopeChanged', args, enq, { target: 'scopeChanged' })
							}
						}
						if (matchesState({ validating: 'cancelling' }, args.value)) {
							{
								return complete('cancelled', args, enq, { target: 'cancelled' })
							}
						}
						return {
							target: 'classifying',
							context: {
								result: (({ event }): FormResult<Result, Reason> => {
									const issues = options.validationIssues(event.error)
									return issues === undefined
										? { outcome: 'failed', code: 'validationFailed', settlement: 'notStarted' }
										: { outcome: 'invalid', issues, settlement: 'notStarted' }
								})(args)
							} satisfies Partial<Context>
						}
					}
				}),
				on: {
					OBSERVE: (args) => {
						const { event } = args
						return {
							context: {
								observation: event.type === 'OBSERVE' ? event.observation : args.context.observation
							} satisfies Partial<Context>
						}
					},
					INVALIDATE: { target: '.invalidated' },
					CANCEL: { target: '.cancelling' },
					SHUTDOWN: { target: '.closing' }
				},
				states: {
					pending: {},
					cancelling: { tags: ['cancelling'], on: { CANCEL: {} } },
					invalidated: { tags: ['scopeChanged'], on: { CANCEL: {}, INVALIDATE: {} } },
					closing: {
						tags: ['closing'],
						on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} }
					}
				}
			},
			admittingOperation: {
				always: (args, enq) => {
					const { context } = args
					if (context.validated !== undefined && context.observation !== undefined) {
						return { target: 'operating' }
					}
					{
						return complete('failed', args, enq, {
							target: 'failed',
							context: {
								result: { outcome: 'failed', code: 'operationFailed', settlement: 'notStarted' }
							} satisfies Partial<Context>
						})
					}
				}
			},
			operating: {
				entry: publishProgress('operating'),
				tags: ['operating'],
				initial: 'pending',
				invoke: workflow.createInvoke<typeof actors.operation, Context>({
					id: 'operation',
					src: actors.operation,
					input: ({ context }) => {
						if (!context.validated || !context.observation)
							throw new Error('Missing validated form input')
						return {
							request: { ...context.request, values: context.validated.value },
							observation: context.observation
						}
					},
					onDone: (args, enq) => {
						const { event } = args
						if (matchesState({ operating: 'closing' }, args.value)) {
							{
								return complete('closed', args, enq, {
									target: 'closed',
									context: {
										result: formInterruptionResult('closed', event.output)
									} satisfies Partial<Context>
								})
							}
						}
						if (matchesState({ operating: 'invalidated' }, args.value)) {
							{
								return complete('scopeChanged', args, enq, {
									target: 'scopeChanged',
									context: {
										result: formInterruptionResult('scopeChanged', event.output)
									} satisfies Partial<Context>
								})
							}
						}
						if (matchesState({ operating: 'cancelling' }, args.value)) {
							{
								return complete('cancelled', args, enq, {
									target: 'cancelled',
									context: {
										result: formInterruptionResult('cancelled', event.output)
									} satisfies Partial<Context>
								})
							}
						}
						return {
							target: 'classifying',
							context: {
								result: event.output ?? {
									outcome: 'failed',
									code: 'unexpected',
									settlement: 'unknown'
								}
							} satisfies Partial<Context>
						}
					},
					onError: (args, enq) => {
						if (matchesState({ operating: 'closing' }, args.value)) {
							{
								return complete('closed', args, enq, {
									target: 'closed',
									context: {
										result: { outcome: 'closed', settlement: 'unknown' }
									} satisfies Partial<Context>
								})
							}
						}
						if (matchesState({ operating: 'invalidated' }, args.value)) {
							{
								return complete('scopeChanged', args, enq, {
									target: 'scopeChanged',
									context: {
										result: { outcome: 'scopeChanged', settlement: 'unknown' }
									} satisfies Partial<Context>
								})
							}
						}
						if (matchesState({ operating: 'cancelling' }, args.value)) {
							{
								return complete('cancelled', args, enq, {
									target: 'cancelled',
									context: {
										result: { outcome: 'cancelled', settlement: 'unknown' }
									} satisfies Partial<Context>
								})
							}
						}
						{
							return complete('failed', args, enq, {
								target: 'failed',
								context: {
									result: {
										outcome: 'failed',
										code: 'operationFailed',
										settlement: 'unknown'
									}
								} satisfies Partial<Context>
							})
						}
					}
				}),
				on: {
					OBSERVE: (args, enq) => {
						const { event } = args
						enq.sendTo('operation', args.event)
						return {
							context: {
								observation: event.type === 'OBSERVE' ? event.observation : args.context.observation
							} satisfies Partial<Context>
						}
					},
					INVALIDATE: (args, enq) => {
						enq.sendTo('operation', args.event)
						return { target: '.invalidated' }
					},
					CANCEL: (args, enq) => {
						enq.sendTo('operation', args.event)
						return { target: '.cancelling' }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('operation', args.event)
						return { target: '.closing' }
					}
				},
				states: {
					pending: {},
					cancelling: { tags: ['cancelling'], on: { CANCEL: {} } },
					invalidated: { tags: ['scopeChanged'], on: { CANCEL: {}, INVALIDATE: {} } },
					closing: {
						tags: ['closing'],
						on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} }
					}
				}
			},
			classifying: {
				always: (args, enq) => {
					const { context } = args
					if (context.result?.outcome === 'invalid') {
						{
							return complete('invalid', args, enq, { target: 'invalid' })
						}
					}
					if (context.result?.outcome === 'succeeded') {
						{
							return complete('succeeded', args, enq, { target: 'succeeded' })
						}
					}
					if (context.result?.outcome === 'partial') {
						{
							return complete('partial', args, enq, { target: 'partial' })
						}
					}
					if (context.result?.outcome === 'denied') {
						{
							return complete('denied', args, enq, { target: 'denied' })
						}
					}
					if (context.result?.outcome === 'unavailable') {
						{
							return complete('unavailable', args, enq, { target: 'unavailable' })
						}
					}
					if (context.result?.outcome === 'scopeChanged') {
						{
							return complete('scopeChanged', args, enq, { target: 'scopeChanged' })
						}
					}
					if (context.result?.outcome === 'cancelled') {
						{
							return complete('cancelled', args, enq, { target: 'cancelled' })
						}
					}
					if (context.result?.outcome === 'closed') {
						{
							return complete('closed', args, enq, { target: 'closed' })
						}
					}
					{
						return complete('failed', args, enq, { target: 'failed' })
					}
				}
			},
			succeeded: {
				type: 'final'
			},
			partial: {
				type: 'final'
			},
			denied: {
				type: 'final'
			},
			unavailable: {
				type: 'final'
			},
			invalid: {
				type: 'final'
			},
			failed: {
				type: 'final'
			},
			scopeChanged: {
				type: 'final'
			},
			cancelled: {
				type: 'final'
			},
			closed: {
				type: 'final'
			}
		}
	})
}
