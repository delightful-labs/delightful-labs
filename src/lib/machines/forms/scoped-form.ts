import {
	matchesState,
	type StateValue,
	types,
	createAsyncLogic,
	setup,
	type Snapshot,
	type SnapshotFrom
} from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	FormFeedbackInput,
	FeedbackMessage,
	FormCapability,
	FormSchema,
	FormIssue,
	FormCapabilityReportEvent,
	FormMode,
	FormObservation,
	FormOperationResult,
	FormRequest,
	FormResult,
	ScopedFormView,
	FormSubmissionProgressEvent
} from '../../contracts/scoped-form.js'
import { formInterruptionResult } from '../../contracts/scoped-form.js'
import type { ScopedFormOperationLogic } from './submission.js'
import type { ScopedFormAvailabilityLogic } from './readiness.js'
import { createScopedFormSubmissionMachine } from './submission.js'
import { createScopedFormReadinessMachine } from './readiness.js'
export type ScopedFormDependencies = {
	validationIssues: (error: unknown) => readonly FormIssue[] | undefined
	messages: {
		unknown: () => string
		loading: (input: { subject: string }) => string
		loadFailed: (input: { subject: string }) => string
		saved: (input: { subject: string }) => string
		completionFailed: () => string
		interruptedSaved: () => string
		archiveFailed: (input: { subject: string }) => string
		saveFailed: (input: { subject: string }) => string
		settling: () => string
	}
}
export type ScopedFormOptions<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
> = {
	schema: FormSchema<Values>
	availability: ScopedFormAvailabilityLogic<AvailabilitySnapshot, Observation>
	selectAvailability: (snapshot: AvailabilitySnapshot) => FormCapability<Scope, Reason>
	operation: ScopedFormOperationLogic<Values, Scope, Observation, OperationSnapshot>
	scopeOf: (observation: Observation) => Scope
	sameScope: (left: Scope, right: Scope) => boolean
	successContent?: 'replace' | 'retain'
	/** Post-persistence I/O owned by the workflow. */
	complete?: (scope: Scope, signal: AbortSignal) => Promise<void>
	/** Release file drafts and rebuild controls after successful inline saves. */
	resetOnSuccess?: boolean
} & FormMode<Values, Observation>
export function createScopedFormMachine<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
>(
	options: ScopedFormOptions<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		OperationSnapshot
	>,
	dependencies: ScopedFormDependencies
) {
	const submission = createScopedFormSubmissionMachine<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		OperationSnapshot
	>({ ...options, validationIssues: dependencies.validationIssues })
	type Context = {
		observation: FormObservation<Observation> | undefined
		scope:
			| {
					value: Scope
			  }
			| undefined
		scopeRevision: number
		watchGeneration: number
		capability: FormCapability<Scope, Reason> | undefined
		request: FormRequest<Scope> | undefined
		sequence: number
		result: FormResult<Result, Reason> | undefined
		checkpoint: unknown
		draftRevision: number
		draft: unknown
	}
	type Event =
		| FormSubmissionProgressEvent
		| {
				type: 'OBSERVE'
				observation: Observation
		  }
		| {
				type: 'SUBMIT'
				values: unknown
		  }
		| {
				type: 'CHANGE'
				values: unknown
		  }
		| {
				type:
					| 'RESET'
					| 'OPEN'
					| 'CANCEL'
					| 'SHUTDOWN'
					| 'RETRY_READINESS'
					| 'INVALIDATE'
					| 'AVAILABILITY_FAILED'
					| 'OBSERVATION_CHANGED'
					| 'CAPABILITY_ACCEPTED'
		  }
		| FormCapabilityReportEvent<Scope, Reason>
	const availability = createScopedFormReadinessMachine<
		Scope,
		Reason,
		Observation,
		AvailabilitySnapshot
	>(options)
	const completion = createAsyncLogic<
		void,
		{
			scope: Scope
		}
	>({
		run: async ({ input, signal }) => {
			await options.complete?.(input.scope, signal)
		}
	})
	const actors = { availability, submission, completion }
	const ready = (context: Context) =>
		context.capability?.revision === context.observation?.revision &&
		context.capability?.readiness.kind === 'ready' &&
		context.scope !== undefined &&
		options.sameScope(context.capability.scope, context.scope.value)
	const editable = (context: Context) =>
		ready(context) &&
		(options.successContent === 'retain' || context.result?.outcome !== 'succeeded')
	const hasChanges = (context: Context, values: unknown) =>
		options.mode !== 'edit' ||
		(values !== undefined &&
			context.observation !== undefined &&
			!options.valuesEqual(values, options.initialValues(context.observation.facts)))
	const workflow = setup({
		schemas: {
			context: types<Context>(),
			events: {
				FORM_SUBMISSION_PROGRESS: types<EventPayload<Event, 'FORM_SUBMISSION_PROGRESS'>>(),
				OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
				SUBMIT: types<EventPayload<Event, 'SUBMIT'>>(),
				CHANGE: types<EventPayload<Event, 'CHANGE'>>(),
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				RESET: types<EventPayload<Event, 'RESET'>>(),
				OPEN: types<EventPayload<Event, 'OPEN'>>(),
				RETRY_READINESS: types<EventPayload<Event, 'RETRY_READINESS'>>(),
				FORM_CAPABILITY_REPORTED: types<EventPayload<Event, 'FORM_CAPABILITY_REPORTED'>>()
			},
			internalEvents: {
				AVAILABILITY_FAILED: types<EventPayload<Event, 'AVAILABILITY_FAILED'>>(),
				OBSERVATION_CHANGED: types<EventPayload<Event, 'OBSERVATION_CHANGED'>>(),
				CAPABILITY_ACCEPTED: types<EventPayload<Event, 'CAPABILITY_ACCEPTED'>>()
			},
			input: types<Observation>(),
			meta: types<{
				section: string
				label: (input: FormFeedbackInput<Result, Reason>) => readonly FeedbackMessage[]
			}>()
		},
		actors,
		guards: {
			closing: ({ value }: { value: StateValue }) =>
				matchesState({ open: { workflow: { active: 'closing' } } }, value),
			invalidated: ({ value }: { value: StateValue }) =>
				matchesState({ open: { workflow: { active: 'invalidated' } } }, value),
			cancelling: ({ value }: { value: StateValue }) =>
				matchesState({ open: { workflow: { active: 'cancelling' } } }, value),
			idle: ({ value }: { value: StateValue }) =>
				matchesState({ open: { workflow: 'idle' } }, value)
		}
	})
	// Recovery belongs to the current scope lifetime, independently of feedback.
	const acceptCheckpoint = (context: Context, result: FormResult<Result, Reason>) => {
		if (context.request?.scopeRevision !== context.scopeRevision) return undefined
		if (result.outcome === 'succeeded') return undefined
		return result.checkpoint === undefined ? context.checkpoint : result.checkpoint
	}
	const requireObservation = (context: Context) => {
		if (!context.observation) throw new Error('Missing form observation')
		return context.observation
	}
	type Input = FormFeedbackInput<Result, Reason>
	type Label = (input: Input) => readonly FeedbackMessage[]
	const status =
		(label: (input: Input) => string): Label =>
		(input) => [{ text: label(input), role: 'status' }]
	const alert =
		(label: (input: Input) => string): Label =>
		(input) => [{ text: label(input), role: 'alert' }]
	const unknown: Label = alert((input) => input.messages.unknown ?? dependencies.messages.unknown())
	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof workflow.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		closed: (_args) => {
			return {
				context: {
					observation: undefined,
					scope: undefined,
					capability: undefined,
					request: undefined,
					result: undefined,
					checkpoint: undefined,
					draft: undefined
				} satisfies Partial<Context>
			}
		}
	} satisfies Record<
		string,
		(args: CompletionArgs, enq: CompletionQueue) => void | { context?: Partial<Context> }
	>

	return workflow.createMachine({
		id: 'scoped-form',
		initial: 'open',
		context: ({ input }) => ({
			observation: { revision: 0, facts: input },
			scope: { value: options.scopeOf(input) },
			scopeRevision: 0,
			watchGeneration: 1,
			capability: undefined,
			request: undefined,
			sequence: 0,
			result: undefined,
			checkpoint: undefined,
			draftRevision: 0,
			draft: undefined
		}),
		states: {
			open: {
				type: 'parallel',
				onDone: (_args) => {
					return { target: 'closed' }
				},
				on: {
					OBSERVE: (args, enq) => {
						const { context, event } = args
						if (matchesState({ open: { workflow: { active: 'closing' } } }, args.value)) {
							return {}
						}
						if (
							context.scope !== undefined &&
							!options.sameScope(context.scope.value, options.scopeOf(event.observation))
						) {
							enq.raise({ type: 'INVALIDATE' })
							enq.raise({ type: 'OBSERVATION_CHANGED' })
							return {
								context: {
									capability: undefined,
									observation: {
										revision: requireObservation(context).revision + 1,
										facts: event.observation
									},
									scope: { value: options.scopeOf(event.observation) },
									scopeRevision: context.scopeRevision + 1,
									draftRevision: context.draftRevision + 1,
									draft: undefined,
									checkpoint: undefined,
									result: undefined
								} satisfies Partial<Context>
							}
						}
						enq.raise({ type: 'OBSERVATION_CHANGED' })
						return {
							context: {
								capability: undefined,
								observation: {
									revision: requireObservation(context).revision + 1,
									facts: event.observation
								}
							} satisfies Partial<Context>
						}
					},
					FORM_CAPABILITY_REPORTED: (args, enq) => {
						const { context, event } = args
						if (matchesState({ open: { workflow: { active: 'closing' } } }, args.value)) {
							return {}
						}
						if (
							matchesState({ open: { availability: 'watching' } }, args.value) &&
							event.generation === context.watchGeneration &&
							event.capability.revision === context.observation?.revision &&
							context.scope !== undefined &&
							options.sameScope(event.capability.scope, context.scope.value)
						) {
							enq.raise({ type: 'CAPABILITY_ACCEPTED' })
							if (
								event.type === 'FORM_CAPABILITY_REPORTED' &&
								event.capability.readiness.kind === 'blocked'
							)
								enq.raise({ type: 'INVALIDATE' })
							return {
								context: { capability: event.capability } satisfies Partial<Context>
							}
						}
					}
				},
				states: {
					availability: {
						initial: 'watching',
						states: {
							watching: {
								initial: 'awaiting',
								states: {
									awaiting: {
										meta: {
											section: 'readiness',
											label: status(({ subject }) => dependencies.messages.loading({ subject }))
										}
									},
									current: {
										meta: {
											section: 'readiness',
											label: (input: Input): readonly FeedbackMessage[] =>
												input.view.readiness.kind === 'blocked'
													? [
															{
																text: input.reasonText(input.view.readiness.reason),
																role: input.blockedRole(input.view.readiness.reason)
															}
														]
													: []
										}
									}
								},
								invoke: {
									id: 'availability',
									src: actors.availability,
									input: ({ context, self }) => ({
										observation: requireObservation(context),
										delivery: {
											kind: 'watch',
											generation: context.watchGeneration,
											recipient: self
										}
									}),
									onError: { target: 'failed' },
									onDone: { target: 'failed' }
								},
								on: {
									SHUTDOWN: { target: 'closed' },
									OBSERVATION_CHANGED: (args, enq) => {
										const { context } = args
										enq.sendTo('availability', {
											type: 'OBSERVE',
											observation: requireObservation(context)
										})
										return { target: '.awaiting' }
									},
									CAPABILITY_ACCEPTED: { target: '.current' }
								}
							},
							failed: {
								meta: {
									section: 'readiness',
									label: alert(({ subject }) => dependencies.messages.loadFailed({ subject }))
								},
								entry: (args, enq) => {
									enq.raise({ type: 'AVAILABILITY_FAILED' })
									return {
										context: { capability: undefined } satisfies Partial<Context>
									}
								},
								on: {
									RETRY_READINESS: (args) => {
										if (!matchesState({ open: { workflow: 'idle' } }, args.value)) return
										return {
											target: 'watching',
											context: {
												watchGeneration: args.context.watchGeneration + 1,
												capability: undefined
											}
										}
									},
									SHUTDOWN: { target: 'closed' }
								}
							},
							closed: { type: 'final' }
						}
					},
					workflow: {
						initial: 'idle',
						states: {
							idle: {
								initial: 'assessing',
								states: {
									assessing: {
										type: 'choice',
										choice: (args) => {
											const { context } = args
											if (context.result === undefined) {
												return { target: 'quiet' }
											}
											if (context.result !== undefined && context.result.outcome === 'succeeded') {
												return { target: 'saved' }
											}
											if (
												context.result !== undefined &&
												context.result.outcome === 'failed' &&
												context.result.code === 'completionFailed'
											) {
												return { target: 'completionFailed' }
											}
											if (
												context.result !== undefined &&
												(context.result.outcome === 'invalid' ||
													(context.result.outcome === 'failed' &&
														context.result.code === 'validationFailed'))
											) {
												return { target: 'invalid' }
											}
											if (
												context.result !== undefined &&
												(context.result.outcome === 'denied' ||
													context.result.outcome === 'unavailable')
											) {
												return { target: 'blocked' }
											}
											if (
												context.result !== undefined &&
												['scopeChanged', 'cancelled', 'closed'].includes(context.result.outcome)
											) {
												return { target: 'interrupted' }
											}
											return { target: 'failed' }
										}
									},
									quiet: {},
									saved: {
										meta: {
											section: 'result',
											label: status((input) => {
												const feedback = input.view.feedback
												return feedback.kind === 'result' &&
													feedback.result.outcome === 'succeeded' &&
													input.successMessage
													? input.successMessage(feedback.result.value)
													: dependencies.messages.saved({ subject: input.subject })
											})
										}
									},
									completionFailed: {
										meta: {
											section: 'result',
											label: alert(() => dependencies.messages.completionFailed())
										}
									},
									invalid: {
										meta: {
											section: 'result',
											label: (input: Input): readonly FeedbackMessage[] =>
												input.validationMessages.length > 0
													? [{ paragraphs: input.validationMessages, role: 'alert' }]
													: []
										}
									},
									blocked: {
										meta: {
											section: 'result',
											label: (input: Input): readonly FeedbackMessage[] => {
												const feedback = input.view.feedback
												return feedback.kind === 'result' &&
													(feedback.result.outcome === 'denied' ||
														feedback.result.outcome === 'unavailable')
													? [{ text: input.reasonText(feedback.result.reason), role: 'alert' }]
													: []
											}
										}
									},
									interrupted: {
										initial: 'assessing',
										states: {
											assessing: {
												type: 'choice',
												choice: (args) => {
													const { context } = args
													if (
														context.result !== undefined &&
														context.result.settlement === 'locallyPersisted'
													) {
														return { target: 'saved' }
													}
													if (
														context.result !== undefined &&
														context.result.settlement === 'unknown'
													) {
														return { target: 'unknown' }
													}
													return { target: 'quiet' }
												}
											},
											saved: {
												meta: {
													section: 'result',
													label: status(
														(input) =>
															input.messages.interruptedSaved ??
															dependencies.messages.interruptedSaved()
													)
												}
											},
											unknown: { meta: { section: 'result', label: unknown } },
											quiet: {}
										}
									},
									failed: {
										meta: {
											section: 'result',
											label: alert((input) =>
												input.action === 'archive'
													? dependencies.messages.archiveFailed({ subject: input.subject })
													: dependencies.messages.saveFailed({ subject: input.subject })
											)
										},
										initial: 'assessing',
										states: {
											assessing: {
												type: 'choice',
												choice: (args) => {
													const { context } = args
													if (
														context.result !== undefined &&
														context.result.settlement === 'unknown'
													) {
														return { target: 'unknown' }
													}
													return { target: 'quiet' }
												}
											},
											unknown: { meta: { section: 'result', label: unknown } },
											quiet: {}
										}
									}
								},
								tags: ['can-open'],
								on: {
									OBSERVATION_CHANGED: { target: '.assessing' },
									SUBMIT: (args) => {
										const { context, event } = args
										if (
											!(
												matchesState({ open: { availability: 'watching' } }, args.value) &&
												editable(context) &&
												hasChanges(context, event.values)
											)
										)
											return
										return {
											target: 'admittingSubmission',
											context: {
												request: (({ context, event }) => {
													if (!context.scope) return undefined
													return {
														id: context.sequence + 1,
														scope: context.scope.value,
														scopeRevision: context.scopeRevision,
														...(context.checkpoint === undefined
															? {}
															: { checkpoint: context.checkpoint }),
														values: event.values
													}
												})(args),
												sequence: context.sequence + 1,
												draft: options.mode === 'edit' ? event.values : undefined,
												result: undefined
											} satisfies Partial<Context>
										}
									},
									CHANGE: (args) => {
										const { context } = args
										if (
											!(
												matchesState({ open: { availability: 'watching' } }, args.value) &&
												editable(context)
											)
										)
											return
										return {
											target: '.assessing',
											context: {
												draft: options.mode === 'edit' ? args.event.values : undefined,
												result: context.result?.outcome === 'succeeded' ? undefined : context.result
											} satisfies Partial<Context>
										}
									},
									RESET: (args) => {
										return {
											target: '.assessing',
											context: {
												draft: undefined,
												checkpoint: undefined,
												result: undefined,
												draftRevision: args.context.draftRevision + 1
											} satisfies Partial<Context>
										}
									},
									OPEN: (args) => {
										const { context } = args
										if (!(context.result?.outcome === 'succeeded')) return
										return {
											target: '.assessing',
											context: {
												draft: undefined,
												checkpoint: undefined,
												result: undefined,
												draftRevision: context.draftRevision + 1
											} satisfies Partial<Context>
										}
									},
									SHUTDOWN: { target: 'closed' }
								}
							},
							admittingSubmission: {
								always: (args) => {
									const { context } = args
									if (context.request !== undefined && context.observation !== undefined) {
										return { target: 'active' }
									}
									return {
										target: 'idle',
										context: {
											result: {
												outcome: 'failed',
												code: 'operationFailed',
												settlement: 'notStarted'
											}
										} satisfies Partial<Context>
									}
								}
							},
							active: {
								initial: 'pending',
								invoke: {
									id: 'submission',
									src: actors.submission,
									input: ({ context, self }) => {
										if (!context.request) throw new Error('Missing form request')
										return {
											request: context.request,
											observation: requireObservation(context),
											recipient: self
										}
									},
									onDone: (args) => {
										const { context, event } = args
										if (matchesState({ open: { workflow: { active: 'closing' } } }, args.value)) {
											return { target: 'closed' }
										}
										if (
											matchesState({ open: { workflow: { active: 'invalidated' } } }, args.value)
										) {
											return {
												target: 'idle',
												context: {
													checkpoint: acceptCheckpoint(context, event.output),
													result:
														context.request?.scopeRevision === context.scopeRevision
															? formInterruptionResult('scopeChanged', event.output)
															: undefined,
													request: undefined
												} satisfies Partial<Context>
											}
										}
										if (
											matchesState({ open: { workflow: { active: 'cancelling' } } }, args.value)
										) {
											return {
												target: 'idle',
												context: {
													checkpoint: acceptCheckpoint(context, event.output),
													result:
														context.request?.scopeRevision === context.scopeRevision
															? formInterruptionResult('cancelled', event.output)
															: undefined,
													request: undefined
												} satisfies Partial<Context>
											}
										}
										if (
											options.complete !== undefined &&
											event.output.outcome === 'succeeded' &&
											context.request?.scopeRevision === context.scopeRevision
										) {
											return {
												target: 'completion',
												context: {
													checkpoint: acceptCheckpoint(context, event.output),
													result: event.output,
													request: undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'idle',
											context: {
												checkpoint: acceptCheckpoint(context, event.output),
												result:
													context.request?.scopeRevision === context.scopeRevision
														? event.output
														: undefined,
												draft:
													options.resetOnSuccess && event.output.outcome === 'succeeded'
														? undefined
														: context.draft,
												draftRevision:
													options.resetOnSuccess && event.output.outcome === 'succeeded'
														? context.draftRevision + 1
														: context.draftRevision,
												request: undefined
											} satisfies Partial<Context>
										}
									},
									onError: (args) => {
										const { context } = args
										if (matchesState({ open: { workflow: { active: 'closing' } } }, args.value)) {
											return { target: 'closed' }
										}
										if (
											matchesState({ open: { workflow: { active: 'invalidated' } } }, args.value)
										) {
											return {
												target: 'idle',
												context: {
													result:
														context.request?.scopeRevision === context.scopeRevision
															? { outcome: 'scopeChanged', settlement: 'unknown' }
															: undefined,
													request: undefined
												} satisfies Partial<Context>
											}
										}
										if (
											matchesState({ open: { workflow: { active: 'cancelling' } } }, args.value)
										) {
											return {
												target: 'idle',
												context: {
													result:
														context.request?.scopeRevision === context.scopeRevision
															? { outcome: 'cancelled', settlement: 'unknown' }
															: undefined,
													request: undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'idle',
											context: {
												result:
													context.request?.scopeRevision === context.scopeRevision
														? {
																outcome: 'failed',
																code: 'unexpected',
																settlement: 'unknown'
															}
														: undefined,
												request: undefined
											} satisfies Partial<Context>
										}
									}
								},
								on: {
									INVALIDATE: (args, enq) => {
										enq.sendTo('submission', { type: 'INVALIDATE' })
										return { target: '.invalidated' }
									},
									AVAILABILITY_FAILED: (args, enq) => {
										enq.sendTo('submission', { type: 'INVALIDATE' })
										return { target: '.invalidated' }
									},
									CANCEL: (args, enq) => {
										enq.sendTo('submission', { type: 'CANCEL' })
										return { target: '.cancelling' }
									},
									SHUTDOWN: (args, enq) => {
										enq.sendTo('submission', { type: 'SHUTDOWN' })
										return { target: '.closing' }
									},
									OBSERVATION_CHANGED: (args, enq) => {
										const { context } = args
										enq.sendTo('submission', {
											type: 'OBSERVE',
											observation: requireObservation(context)
										})
									}
								},
								states: {
									pending: {
										tags: ['can-open'],
										initial: 'awaitingProgress',
										states: {
											awaitingProgress: {},
											validating: { tags: ['validating'] },
											operating: {}
										},
										on: {
											FORM_SUBMISSION_PROGRESS: (args) => {
												const { context, event } = args
												if (
													context.request?.id === event.requestId &&
													context.request.scopeRevision === event.scopeRevision &&
													context.scopeRevision === event.scopeRevision &&
													event.progress === 'validating'
												) {
													return { target: '.validating' }
												}
												if (
													context.request?.id === event.requestId &&
													context.request.scopeRevision === event.scopeRevision &&
													context.scopeRevision === event.scopeRevision &&
													event.progress === 'operating'
												) {
													return { target: '.operating' }
												}
											}
										}
									},
									cancelling: {
										meta: {
											section: 'readiness',
											label: status(
												(input) => input.messages.settling ?? dependencies.messages.settling()
											)
										},
										tags: ['can-open'],
										on: { CANCEL: {} }
									},
									invalidated: {
										meta: {
											section: 'readiness',
											label: status(
												(input) => input.messages.settling ?? dependencies.messages.settling()
											)
										},
										tags: ['can-open'],
										on: { CANCEL: {}, INVALIDATE: {}, AVAILABILITY_FAILED: {} }
									},
									closing: {
										meta: {
											section: 'readiness',
											label: status(
												(input) => input.messages.settling ?? dependencies.messages.settling()
											)
										},
										on: {
											SHUTDOWN: {},
											CANCEL: {},
											INVALIDATE: {},
											AVAILABILITY_FAILED: {},
											OBSERVE: {},
											FORM_CAPABILITY_REPORTED: {}
										}
									}
								}
							},
							completion: {
								initial: 'admitting',
								on: {
									SHUTDOWN: { target: 'closed' },
									INVALIDATE: (args) => {
										// Scope changes clear the result before raising INVALIDATE.
										// Capability refreshes cannot undo an already persisted success.
										const { context } = args
										if (!(context.result === undefined)) return
										return {
											target: 'idle',
											context: {
												draft: undefined,
												checkpoint: undefined,
												result: undefined,
												draftRevision: context.draftRevision + 1
											} satisfies Partial<Context>
										}
									},
									CANCEL: (args) => {
										return {
											target: 'idle',
											context: {
												draft: undefined,
												checkpoint: undefined,
												result: undefined,
												draftRevision: args.context.draftRevision + 1
											} satisfies Partial<Context>
										}
									}
								},
								states: {
									admitting: {
										type: 'choice',
										choice: (args) => {
											if (args.context.scope !== undefined && options.complete !== undefined) {
												return { target: 'navigating' }
											}
											return { target: 'failed' }
										}
									},
									navigating: {
										invoke: {
											id: 'completion',
											src: actors.completion,
											input: ({ context }) => {
												if (!context.scope) throw new Error('Missing saved form scope')
												return { scope: context.scope.value }
											},
											onDone: { target: 'completed' },
											onError: { target: 'failed' }
										}
									},
									failed: {
										meta: {
											section: 'result',
											label: alert(() => dependencies.messages.completionFailed())
										},
										on: { SUBMIT: { target: 'admitting' } }
									},
									completed: {}
								}
							},
							closed: { type: 'final' }
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: finalizers.closed
			}
		}
	})
}
export function selectScopedFormView<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
>(
	snapshot: Pick<
		SnapshotFrom<
			ReturnType<
				typeof createScopedFormMachine<
					Values,
					Result,
					Reason,
					Scope,
					Observation,
					AvailabilitySnapshot,
					OperationSnapshot
				>
			>
		>,
		'context' | 'status' | 'matches' | 'getMeta' | 'hasTag'
	> & {
		can: (
			event:
				| {
						type: 'SUBMIT' | 'CHANGE'
						values: unknown
				  }
				| {
						type: 'RESET' | 'RETRY_READINESS'
				  }
		) => boolean
	},
	options: Pick<
		ScopedFormOptions<
			Values,
			Result,
			Reason,
			Scope,
			Observation,
			AvailabilitySnapshot,
			OperationSnapshot
		>,
		'successContent'
	>
): ScopedFormView<Result, Reason> {
	const { capability, result } = snapshot.context
	const closing = snapshot.matches({ open: { workflow: { active: 'closing' } } })
	const invalidated = snapshot.matches({ open: { workflow: { active: 'invalidated' } } })
	const cancelling = snapshot.matches({ open: { workflow: { active: 'cancelling' } } })
	const closed =
		snapshot.status === 'done' || snapshot.matches({ open: { availability: 'closed' } })
	const failed = snapshot.status === 'error' || snapshot.status === 'stopped'
	const completing = snapshot.matches({ open: { workflow: 'completion' } })
	const navigationPending = snapshot.matches({ open: { workflow: { completion: 'navigating' } } })
	const completionFailed = snapshot.matches({ open: { workflow: { completion: 'failed' } } })
	const readiness: ScopedFormView<Result, Reason>['readiness'] = closed
		? { kind: 'closed' }
		: completing
			? { kind: 'ready' }
			: failed || snapshot.matches({ open: { availability: 'failed' } })
				? { kind: 'failed' }
				: snapshot.matches({ open: { availability: { watching: 'current' } } }) && capability
					? capability.readiness
					: { kind: 'observing' }
	const canSubmit = !failed && snapshot.can({ type: 'SUBMIT', values: snapshot.context.draft })
	return {
		feedbackLabels: Object.values(snapshot.getMeta()).flatMap((meta) =>
			meta?.label
				? [{ section: meta.section === 'readiness' ? 'readiness' : 'result', label: meta.label }]
				: []
		),
		readiness,
		content:
			!completing && result?.outcome === 'succeeded' && options.successContent !== 'retain'
				? { kind: 'success', value: result.value }
				: { kind: 'fields' },
		activity: failed
			? { kind: 'idle' }
			: closing || invalidated || cancelling
				? {
						kind: 'settling',
						reason: closing ? 'closed' : invalidated ? 'scopeChanged' : 'cancelled'
					}
				: snapshot.hasTag('validating')
					? { kind: 'validating' }
					: snapshot.matches({ open: { workflow: 'active' } }) || navigationPending
						? { kind: 'operating' }
						: { kind: 'idle' },
		feedback: completionFailed
			? {
					kind: 'result',
					result: {
						outcome: 'failed',
						code: 'completionFailed',
						settlement: result?.settlement ?? 'locallyPersisted'
					}
				}
			: !completing && result
				? { kind: 'result', result }
				: { kind: 'none' },
		canSubmit,
		fieldsEditable: !failed && snapshot.can({ type: 'CHANGE', values: undefined }),
		canReset: !failed && snapshot.can({ type: 'RESET' }),
		canOpen: !failed && snapshot.hasTag('can-open'),
		canCancel: !failed && snapshot.matches({ open: { workflow: { active: 'pending' } } }),
		canRetryReadiness: !failed && snapshot.can({ type: 'RETRY_READINESS' }),
		draftRevision: snapshot.context.draftRevision
	}
}
