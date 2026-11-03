import {
	assign,
	fromPromise,
	raise,
	and,
	setup,
	stateIn,
	type Snapshot,
	type SnapshotFrom
} from 'xstate'
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
		scope: { value: Scope } | undefined
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
		| { type: 'OBSERVE'; observation: Observation }
		| { type: 'SUBMIT'; values: unknown }
		| { type: 'CHANGE'; values: unknown }
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
	const completion = fromPromise<void, { scope: Scope }>(async ({ input, signal }) => {
		if (!options.complete) throw new Error('Missing form completion effect')
		await options.complete(input.scope, signal)
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
	const workflow = setup<
		Context,
		Event,
		typeof actors,
		{ availability: 'availability'; submission: 'submission'; completion: 'completion' },
		{},
		{
			closing: undefined
			invalidated: undefined
			cancelling: undefined
			availabilityWatching: undefined
			idle: undefined
		},
		never,
		string,
		Observation
	>({
		actors,
		guards: {
			closing: stateIn({ open: { workflow: { active: 'closing' } } }),
			invalidated: stateIn({ open: { workflow: { active: 'invalidated' } } }),
			cancelling: stateIn({ open: { workflow: { active: 'cancelling' } } }),
			availabilityWatching: stateIn({ open: { availability: 'watching' } }),
			idle: stateIn({ open: { workflow: 'idle' } })
		}
	})
	const forwardObservation = workflow.enqueueActions(({ self, context, enqueue }) => {
		const children = self.getSnapshot().children
		const observation = context.observation
		if (!observation) return
		if (children.availability?.getSnapshot().status === 'active')
			enqueue.sendTo(children.availability, { type: 'OBSERVE', observation })
		if (children.submission?.getSnapshot().status === 'active')
			enqueue.sendTo(children.submission, { type: 'OBSERVE', observation })
	})
	const command = (type: 'INVALIDATE' | 'CANCEL' | 'SHUTDOWN') =>
		workflow.enqueueActions(({ self, enqueue }) => {
			const child = self.getSnapshot().children.submission
			if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type })
		})
	// Recovery belongs to the current scope lifetime, independently of feedback.
	const acceptCheckpoint = (context: Context, result: FormResult<Result, Reason>) => {
		if (context.request?.scopeRevision !== context.scopeRevision) return undefined
		if (result.outcome === 'succeeded') return undefined
		return result.checkpoint === undefined ? context.checkpoint : result.checkpoint
	}
	const clearDraft = workflow.assign({
		draft: undefined,
		checkpoint: undefined,
		result: undefined,
		draftRevision: ({ context }) => context.draftRevision + 1
	})
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

	return workflow.createMachine({
		id: 'scoped-form',
		initial: 'open',
		context: ({ input }) => ({
			observation: { revision: 0, facts: input },
			scope: { value: options.scopeOf(input) },
			scopeRevision: 0,
			watchGeneration: 0,
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
				onDone: 'closed',
				on: {
					OBSERVE: [
						{ guard: 'closing' },
						{
							guard: ({ context, event }) =>
								context.scope !== undefined &&
								!options.sameScope(context.scope.value, options.scopeOf(event.observation)),
							actions: [
								assign({
									capability: undefined,
									observation: ({ context, event }) => ({
										revision: requireObservation(context).revision + 1,
										facts: event.observation
									}),
									scope: ({ event }) => ({ value: options.scopeOf(event.observation) }),
									scopeRevision: ({ context }) => context.scopeRevision + 1,
									draftRevision: ({ context }) => context.draftRevision + 1,
									draft: undefined,
									checkpoint: undefined,
									result: undefined
								}),
								raise({ type: 'INVALIDATE' }),
								raise({ type: 'OBSERVATION_CHANGED' }),
								forwardObservation
							]
						},
						{
							actions: [
								assign({
									capability: undefined,
									observation: ({ context, event }) => ({
										revision: requireObservation(context).revision + 1,
										facts: event.observation
									})
								}),
								raise({ type: 'OBSERVATION_CHANGED' }),
								forwardObservation
							]
						}
					],
					FORM_CAPABILITY_REPORTED: [
						{ guard: 'closing' },
						{
							guard: and([
								'availabilityWatching',
								({ context, event }) =>
									event.generation === context.watchGeneration &&
									event.capability.revision === context.observation?.revision &&
									context.scope !== undefined &&
									options.sameScope(event.capability.scope, context.scope.value)
							]),
							actions: [
								assign({ capability: ({ event }) => event.capability }),
								raise({ type: 'CAPABILITY_ACCEPTED' }),
								workflow.enqueueActions(({ event, enqueue }) => {
									if (
										event.type === 'FORM_CAPABILITY_REPORTED' &&
										event.capability.readiness.kind === 'blocked'
									)
										enqueue.raise({ type: 'INVALIDATE' })
								})
							]
						}
					]
				},
				states: {
					availability: {
						initial: 'watching',
						states: {
							watching: {
								entry: assign({
									watchGeneration: ({ context }) => context.watchGeneration + 1,
									capability: undefined
								}),
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
									src: 'availability',
									input: ({ context, self }) => ({
										observation: requireObservation(context),
										delivery: {
											kind: 'watch',
											generation: context.watchGeneration,
											recipient: self
										}
									}),
									onError: 'failed',
									onDone: 'failed'
								},
								on: {
									SHUTDOWN: 'closed',
									OBSERVATION_CHANGED: '.awaiting',
									CAPABILITY_ACCEPTED: '.current'
								}
							},
							failed: {
								meta: {
									section: 'readiness',
									label: alert(({ subject }) => dependencies.messages.loadFailed({ subject }))
								},
								entry: [assign({ capability: undefined }), raise({ type: 'AVAILABILITY_FAILED' })],
								on: {
									RETRY_READINESS: {
										guard: 'idle',
										target: 'watching'
									},
									SHUTDOWN: 'closed'
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
										always: [
											{ guard: ({ context }) => context.result === undefined, target: 'quiet' },
											{
												guard: ({ context }) =>
													context.result !== undefined && context.result.outcome === 'succeeded',
												target: 'saved'
											},
											{
												guard: ({ context }) =>
													context.result !== undefined &&
													context.result.outcome === 'failed' &&
													context.result.code === 'completionFailed',
												target: 'completionFailed'
											},
											{
												guard: ({ context }) =>
													context.result !== undefined &&
													(context.result.outcome === 'invalid' ||
														(context.result.outcome === 'failed' &&
															context.result.code === 'validationFailed')),
												target: 'invalid'
											},
											{
												guard: ({ context }) =>
													context.result !== undefined &&
													(context.result.outcome === 'denied' ||
														context.result.outcome === 'unavailable'),
												target: 'blocked'
											},
											{
												guard: ({ context }) =>
													context.result !== undefined &&
													['scopeChanged', 'cancelled', 'closed'].includes(context.result.outcome),
												target: 'interrupted'
											},
											{ target: 'failed' }
										]
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
												always: [
													{
														guard: ({ context }) =>
															context.result !== undefined &&
															context.result.settlement === 'locallyPersisted',
														target: 'saved'
													},
													{
														guard: ({ context }) =>
															context.result !== undefined &&
															context.result.settlement === 'unknown',
														target: 'unknown'
													},
													{ target: 'quiet' }
												]
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
												always: [
													{
														guard: ({ context }) =>
															context.result !== undefined &&
															context.result.settlement === 'unknown',
														target: 'unknown'
													},
													{ target: 'quiet' }
												]
											},
											unknown: { meta: { section: 'result', label: unknown } },
											quiet: {}
										}
									}
								},
								tags: 'can-open',
								on: {
									OBSERVATION_CHANGED: '.assessing',
									SUBMIT: {
										guard: and([
											'availabilityWatching',
											({ context, event }) => editable(context) && hasChanges(context, event.values)
										]),
										target: 'active',
										actions: assign({
											request: ({ context, event }) => {
												if (!context.scope) throw new Error('Missing form scope')
												return {
													id: context.sequence + 1,
													scope: context.scope.value,
													scopeRevision: context.scopeRevision,
													...(context.checkpoint === undefined
														? {}
														: { checkpoint: context.checkpoint }),
													values: event.values
												}
											},
											sequence: ({ context }) => context.sequence + 1,
											draft: ({ event }) => (options.mode === 'edit' ? event.values : undefined),
											result: undefined
										})
									},
									CHANGE: {
										target: '.assessing',
										guard: and(['availabilityWatching', ({ context }) => editable(context)]),
										actions: assign({
											draft: ({ event }) => (options.mode === 'edit' ? event.values : undefined),
											result: ({ context }) =>
												context.result?.outcome === 'succeeded' ? undefined : context.result
										})
									},
									RESET: { target: '.assessing', actions: clearDraft },
									OPEN: {
										target: '.assessing',
										guard: ({ context }) => context.result?.outcome === 'succeeded',
										actions: clearDraft
									},
									SHUTDOWN: 'closed'
								}
							},
							active: {
								initial: 'pending',
								invoke: {
									id: 'submission',
									src: 'submission',
									input: ({ context, self }) => {
										if (!context.request) throw new Error('Missing form request')
										return {
											request: context.request,
											observation: requireObservation(context),
											recipient: self
										}
									},
									onDone: [
										{ guard: 'closing', target: 'closed' },
										{
											guard: 'invalidated',
											target: 'idle',
											actions: assign({
												checkpoint: ({ context, event }) => acceptCheckpoint(context, event.output),
												result: ({ context, event }) =>
													context.request?.scopeRevision === context.scopeRevision
														? formInterruptionResult('scopeChanged', event.output)
														: undefined,
												request: undefined
											})
										},
										{
											guard: 'cancelling',
											target: 'idle',
											actions: assign({
												checkpoint: ({ context, event }) => acceptCheckpoint(context, event.output),
												result: ({ context, event }) =>
													context.request?.scopeRevision === context.scopeRevision
														? formInterruptionResult('cancelled', event.output)
														: undefined,
												request: undefined
											})
										},
										{
											guard: ({ context, event }) =>
												options.complete !== undefined &&
												event.output.outcome === 'succeeded' &&
												context.request?.scopeRevision === context.scopeRevision,
											target: 'completion',
											actions: assign({
												checkpoint: ({ context, event }) => acceptCheckpoint(context, event.output),
												result: ({ event }) => event.output,
												request: undefined
											})
										},
										{
											target: 'idle',
											actions: assign({
												checkpoint: ({ context, event }) => acceptCheckpoint(context, event.output),
												result: ({ context, event }) =>
													context.request?.scopeRevision === context.scopeRevision
														? event.output
														: undefined,
												draft: ({ context, event }) =>
													options.resetOnSuccess && event.output.outcome === 'succeeded'
														? undefined
														: context.draft,
												draftRevision: ({ context, event }) =>
													options.resetOnSuccess && event.output.outcome === 'succeeded'
														? context.draftRevision + 1
														: context.draftRevision,
												request: undefined
											})
										}
									],
									onError: [
										{ guard: 'closing', target: 'closed' },
										{
											guard: 'invalidated',
											target: 'idle',
											actions: assign({
												result: ({ context }) =>
													context.request?.scopeRevision === context.scopeRevision
														? { outcome: 'scopeChanged', settlement: 'unknown' }
														: undefined,
												request: undefined
											})
										},
										{
											guard: 'cancelling',
											target: 'idle',
											actions: assign({
												result: ({ context }) =>
													context.request?.scopeRevision === context.scopeRevision
														? { outcome: 'cancelled', settlement: 'unknown' }
														: undefined,
												request: undefined
											})
										},
										{
											target: 'idle',
											actions: assign({
												result: ({ context }) =>
													context.request?.scopeRevision === context.scopeRevision
														? {
																outcome: 'failed',
																code: 'unexpected',
																settlement: 'unknown'
															}
														: undefined,
												request: undefined
											})
										}
									]
								},
								on: {
									INVALIDATE: { target: '.invalidated', actions: command('INVALIDATE') },
									AVAILABILITY_FAILED: { target: '.invalidated', actions: command('INVALIDATE') },
									CANCEL: { target: '.cancelling', actions: command('CANCEL') },
									SHUTDOWN: { target: '.closing', actions: command('SHUTDOWN') }
								},
								states: {
									pending: {
										tags: 'can-open',
										initial: 'awaitingProgress',
										states: {
											awaitingProgress: {},
											validating: { tags: 'validating' },
											operating: {}
										},
										on: {
											FORM_SUBMISSION_PROGRESS: [
												{
													guard: ({ context, event }) =>
														context.request?.id === event.requestId &&
														context.request.scopeRevision === event.scopeRevision &&
														context.scopeRevision === event.scopeRevision &&
														event.progress === 'validating',
													target: '.validating'
												},
												{
													guard: ({ context, event }) =>
														context.request?.id === event.requestId &&
														context.request.scopeRevision === event.scopeRevision &&
														context.scopeRevision === event.scopeRevision &&
														event.progress === 'operating',
													target: '.operating'
												}
											]
										}
									},
									cancelling: {
										meta: {
											section: 'readiness',
											label: status(
												(input) => input.messages.settling ?? dependencies.messages.settling()
											)
										},
										tags: 'can-open',
										on: { CANCEL: {} }
									},
									invalidated: {
										meta: {
											section: 'readiness',
											label: status(
												(input) => input.messages.settling ?? dependencies.messages.settling()
											)
										},
										tags: 'can-open',
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
								initial: 'navigating',
								on: {
									SHUTDOWN: 'closed',
									INVALIDATE: {
										// Scope changes clear the result before raising INVALIDATE.
										// Capability refreshes cannot undo an already persisted success.
										guard: ({ context }) => context.result === undefined,
										target: 'idle',
										actions: clearDraft
									},
									CANCEL: { target: 'idle', actions: clearDraft }
								},
								states: {
									navigating: {
										invoke: {
											id: 'completion',
											src: 'completion',
											input: ({ context }) => {
												if (!context.scope) throw new Error('Missing saved form scope')
												return { scope: context.scope.value }
											},
											onDone: 'completed',
											onError: 'failed'
										}
									},
									failed: {
										meta: {
											section: 'result',
											label: alert(() => dependencies.messages.completionFailed())
										},
										on: { SUBMIT: 'navigating' }
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
				entry: workflow.assign({
					observation: undefined,
					scope: undefined,
					capability: undefined,
					request: undefined,
					result: undefined,
					checkpoint: undefined,
					draft: undefined
				})
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
			event: { type: 'SUBMIT' | 'CHANGE'; values: unknown } | { type: 'RESET' | 'RETRY_READINESS' }
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
