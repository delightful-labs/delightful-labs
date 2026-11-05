import {
	forwardTo,
	assign,
	fromPromise,
	setup,
	stateIn,
	type ActorLogic,
	type ActorRef,
	type Snapshot
} from 'xstate'
import { formInterruptionResult } from '../../contracts/scoped-form.js'
import type {
	FormChildEvent,
	FormIssue,
	FormSchema,
	FormInterruption,
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
		validated: { value: Values } | undefined
		result: FormResult<Result, Reason> | undefined
	}
	type Event = FormChildEvent<Observation>
	const actors = {
		validate: fromPromise<Values, unknown>(async ({ input }) => options.schema.parseAsync(input)),
		operation: options.operation
	}
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{
			closing: undefined
			invalidated: undefined
			cancelling: undefined
			operationClosing: undefined
			operationInvalidated: undefined
			operationCancelling: undefined
		},
		never,
		string,
		ScopedFormSubmissionInput<Scope, Observation>,
		FormResult<Result, Reason>
	>({
		actors,
		guards: {
			closing: stateIn({ validating: 'closing' }),
			invalidated: stateIn({ validating: 'invalidated' }),
			cancelling: stateIn({ validating: 'cancelling' }),
			operationClosing: stateIn({ operating: 'closing' }),
			operationInvalidated: stateIn({ operating: 'invalidated' }),
			operationCancelling: stateIn({ operating: 'cancelling' })
		}
	})
	const publishProgress = (progress: FormSubmissionProgressEvent['progress']) =>
		workflow.enqueueActions(({ context, enqueue }) => {
			if (!context.recipient) return
			enqueue.sendTo(context.recipient, {
				type: 'FORM_SUBMISSION_PROGRESS',
				requestId: context.request.id,
				scopeRevision: context.request.scopeRevision,
				progress
			})
		})
	const observe = workflow.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVE' ? event.observation : context.observation
	})

	const clearPayloads = workflow.assign({
		request: ({ context }) => ({ ...context.request, values: undefined, checkpoint: undefined }),
		validated: undefined,
		recipient: undefined,
		observation: undefined
	})
	const finishInterrupted = (outcome: FormInterruption) =>
		workflow.createStateConfig({
			type: 'final',
			entry: [
				workflow.assign({
					result: ({ context }) => context.result ?? { outcome, settlement: 'notStarted' }
				}),
				clearPayloads
			]
		})
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
				tags: 'validating',
				invoke: {
					src: 'validate',
					input: ({ context }: { context: Context }) => context.request.values,
					onDone: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'invalidated', target: 'scopeChanged' },
						{ guard: 'cancelling', target: 'cancelled' },
						{
							target: 'admittingOperation',
							actions: assign({ validated: ({ event }) => ({ value: event.output }) })
						}
					],
					onError: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'invalidated', target: 'scopeChanged' },
						{ guard: 'cancelling', target: 'cancelled' },
						{
							target: 'classifying',
							actions: assign({
								result: ({ event }): FormResult<Result, Reason> => {
									const issues = options.validationIssues(event.error)
									return issues === undefined
										? { outcome: 'failed', code: 'validationFailed', settlement: 'notStarted' }
										: { outcome: 'invalid', issues, settlement: 'notStarted' }
								}
							})
						}
					]
				},
				on: {
					OBSERVE: { actions: observe },
					INVALIDATE: '.invalidated',
					CANCEL: '.cancelling',
					SHUTDOWN: '.closing'
				},
				states: {
					pending: {},
					cancelling: { tags: 'cancelling', on: { CANCEL: {} } },
					invalidated: { tags: 'scopeChanged', on: { CANCEL: {}, INVALIDATE: {} } },
					closing: {
						tags: 'closing',
						on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} }
					}
				}
			},
			admittingOperation: {
				always: [
					{
						guard: ({ context }) =>
							context.validated !== undefined && context.observation !== undefined,
						target: 'operating'
					},
					{
						target: 'failed',
						actions: assign({
							result: { outcome: 'failed', code: 'operationFailed', settlement: 'notStarted' }
						})
					}
				]
			},
			operating: {
				entry: publishProgress('operating'),
				tags: 'operating',
				initial: 'pending',
				invoke: {
					id: 'operation',
					src: 'operation',
					input: ({ context }) => {
						if (!context.validated || !context.observation)
							throw new Error('Missing validated form input')
						return {
							request: { ...context.request, values: context.validated.value },
							observation: context.observation
						}
					},
					onDone: [
						{
							guard: 'operationClosing',
							target: 'closed',
							actions: assign({
								result: ({ event }) => formInterruptionResult('closed', event.output)
							})
						},
						{
							guard: 'operationInvalidated',
							target: 'scopeChanged',
							actions: assign({
								result: ({ event }) => formInterruptionResult('scopeChanged', event.output)
							})
						},
						{
							guard: 'operationCancelling',
							target: 'cancelled',
							actions: assign({
								result: ({ event }) => formInterruptionResult('cancelled', event.output)
							})
						},
						{
							target: 'classifying',
							actions: assign({
								result: ({ event }) =>
									event.output ?? { outcome: 'failed', code: 'unexpected', settlement: 'unknown' }
							})
						}
					],
					onError: [
						{
							guard: 'operationClosing',
							target: 'closed',
							actions: assign({ result: () => ({ outcome: 'closed', settlement: 'unknown' }) })
						},
						{
							guard: 'operationInvalidated',
							target: 'scopeChanged',
							actions: assign({
								result: () => ({ outcome: 'scopeChanged', settlement: 'unknown' })
							})
						},
						{
							guard: 'operationCancelling',
							target: 'cancelled',
							actions: assign({ result: () => ({ outcome: 'cancelled', settlement: 'unknown' }) })
						},
						{
							target: 'failed',
							actions: assign({
								result: () => ({
									outcome: 'failed',
									code: 'operationFailed',
									settlement: 'unknown'
								})
							})
						}
					]
				},
				on: {
					OBSERVE: { actions: [observe, forwardTo('operation')] },
					INVALIDATE: { target: '.invalidated', actions: forwardTo('operation') },
					CANCEL: { target: '.cancelling', actions: forwardTo('operation') },
					SHUTDOWN: { target: '.closing', actions: forwardTo('operation') }
				},
				states: {
					pending: {},
					cancelling: { tags: 'cancelling', on: { CANCEL: {} } },
					invalidated: { tags: 'scopeChanged', on: { CANCEL: {}, INVALIDATE: {} } },
					closing: {
						tags: 'closing',
						on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} }
					}
				}
			},
			classifying: {
				always: [
					{ guard: ({ context }) => context.result?.outcome === 'invalid', target: 'invalid' },
					{ guard: ({ context }) => context.result?.outcome === 'succeeded', target: 'succeeded' },
					{ guard: ({ context }) => context.result?.outcome === 'partial', target: 'partial' },
					{ guard: ({ context }) => context.result?.outcome === 'denied', target: 'denied' },
					{
						guard: ({ context }) => context.result?.outcome === 'unavailable',
						target: 'unavailable'
					},
					{
						guard: ({ context }) => context.result?.outcome === 'scopeChanged',
						target: 'scopeChanged'
					},
					{ guard: ({ context }) => context.result?.outcome === 'cancelled', target: 'cancelled' },
					{ guard: ({ context }) => context.result?.outcome === 'closed', target: 'closed' },
					{ target: 'failed' }
				]
			},
			succeeded: { type: 'final', entry: clearPayloads },
			partial: { type: 'final', entry: clearPayloads },
			denied: { type: 'final', entry: clearPayloads },
			unavailable: { type: 'final', entry: clearPayloads },
			invalid: { type: 'final', entry: clearPayloads },
			failed: { type: 'final', entry: clearPayloads },
			scopeChanged: finishInterrupted('scopeChanged'),
			cancelled: finishInterrupted('cancelled'),
			closed: finishInterrupted('closed')
		}
	})
}
