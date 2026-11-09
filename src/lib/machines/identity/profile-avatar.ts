import {
	matchesState,
	type StateValue,
	types,
	createAsyncLogic,
	setup,
	type ActorLogic,
	type Snapshot
} from 'xstate'
import { createFinalTransitions } from '../finalize.js'

import type { EventPayload } from '../../contracts/machine-events.js'
import type {
	FormChildEvent,
	FormInterruption as _FormInterruption,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '../../contracts/scoped-form.js'
import type { ProfileObservation, ProfileReason, ProfileScope } from '../../contracts/profile.js'
export type ProfileAvatarDraft =
	| {
			action: 'upload'
			file: File
	  }
	| {
			action: 'remove'
	  }
export type ProfileAvatarValues =
	| {
			avatarData: Uint8Array<ArrayBuffer>
			avatarMimeType: 'image/png' | 'image/jpeg' | 'image/webp'
	  }
	| {
			avatarData: null
			avatarMimeType: null
	  }
export type ProfileImageResult =
	| {
			outcome: 'processed'
			blob: Blob
			bytes: Uint8Array
			dimensions: {
				width: number
				height: number
			}
	  }
	| {
			outcome: 'failed'
	  }
export type ProfileImageLogic<S extends Snapshot<ProfileImageResult>> = ActorLogic<
	S,
	{
		type: 'CANCEL' | 'SHUTDOWN'
	},
	{
		file: File
		options: {
			maxWidth: number
			maxHeight: number
			mimeType: 'image/webp'
			quality: number
		}
	}
>
export type ProfileAvatarWriteLogic<S extends Snapshot<FormOperationResult<void, ProfileReason>>> =
	ActorLogic<
		S,
		FormChildEvent<ProfileObservation>,
		FormOperationInput<ProfileAvatarValues, ProfileScope, ProfileObservation>
	>
type Draft = ProfileAvatarDraft
type Values = ProfileAvatarValues
type Input = FormOperationInput<Draft, ProfileScope, ProfileObservation>
type Result = FormOperationResult<void, ProfileReason>
type Event = FormChildEvent<ProfileObservation>
type Context = {
	request: Omit<Input['request'], 'values'> | undefined
	draft: Draft | undefined
	observation: FormObservation<ProfileObservation> | undefined
	blob: Blob | undefined
	bytes: Uint8Array | undefined
	prepared: Values | undefined
	result: Result | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing avatar resource')
	return value
}
const failed: Result = { outcome: 'failed', code: 'operationFailed', settlement: 'notStarted' }
/** Owns image resources through cleanup, then delegates readiness and settlement to the write child. */
export function createProfileAvatarMachine<
	ProcessSnapshot extends Snapshot<ProfileImageResult>,
	WriteSnapshot extends Snapshot<Result>
>(options: {
	processImage: ProfileImageLogic<ProcessSnapshot>
	validateBytes: (input: { bytes: Uint8Array; mimeType: string }) =>
		| {
				success: true
				data: Values
		  }
		| {
				success: false
		  }
	write: ProfileAvatarWriteLogic<WriteSnapshot>
	scopeOf: (facts: ProfileObservation) => ProfileScope
	sameScope: (left: ProfileScope, right: ProfileScope) => boolean
}) {
	const actors = {
		processImage: options.processImage,
		validate: createAsyncLogic({
			run: async ({
				input
			}: {
				input: {
					bytes: Uint8Array
					mimeType: string
				}
			}) => options.validateBytes(input)
		}),
		write: options.write
	}
	const patches = { fail: (_args: { context: Context }): Partial<Context> => ({ result: failed }) }
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<Event, 'INVALIDATE'>>(),
				OBSERVE: types<EventPayload<Event, 'OBSERVE'>>()
			},
			input: types<Input>(),
			output: types<Result>()
		},
		actors,
		actions: {},
		guards: {
			interrupted: ({ value }: { value: StateValue }) =>
				matchesState({ running: { control: 'interrupted' } }, value)
		}
	})

	type CompletionEntry = Extract<
		NonNullable<Parameters<typeof model.createStateConfig>[0]['entry']>,
		(...args: never[]) => unknown
	>
	type CompletionArgs = Pick<Parameters<CompletionEntry>[0], 'context' | 'actions'>
	type CompletionQueue = Parameters<CompletionEntry>[1]
	const finalizers = {
		succeeded: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: context.result ?? failed,
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
		},
		partial: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: context.result ?? failed,
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
		},
		denied: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: context.result ?? failed,
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
		},
		unavailable: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: context.result ?? failed,
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
		},
		failed: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: context.result ?? failed,
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
		},
		closed: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: { outcome: 'closed', settlement: context.result?.settlement ?? 'notStarted' },
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
		},
		scopeChanged: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: {
						outcome: 'scopeChanged',
						settlement: context.result?.settlement ?? 'notStarted'
					},
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
		},
		cancelled: (args, _enq) => {
			const { context } = args
			return {
				context: {
					result: {
						outcome: 'cancelled',
						settlement: context.result?.settlement ?? 'notStarted'
					},
					request: undefined,
					draft: undefined,
					observation: undefined,
					blob: undefined,
					bytes: undefined,
					prepared: undefined
				} satisfies Partial<Context>
			}
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

	return model.createMachine({
		id: 'profile-avatar',
		initial: 'running',
		context: ({ input }) => ({
			request: {
				id: input.request.id,
				scope: input.request.scope,
				scopeRevision: input.request.scopeRevision
			},
			draft: input.request.values,
			observation: input.observation,
			blob: undefined,
			bytes: undefined,
			prepared: undefined,
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
							SHUTDOWN: { target: '.interrupted.closed' },
							OBSERVE: (args) => {
								const { context, event } = args
								if (
									!options.sameScope(
										required(context.request).scope,
										options.scopeOf(event.observation.facts)
									)
								) {
									return {
										target: '.interrupted.scopeChanged',
										context: {
											observation:
												event.type === 'OBSERVE' ? event.observation : context.observation
										} satisfies Partial<Context>
									}
								}
								return {
									context: {
										observation: event.type === 'OBSERVE' ? event.observation : context.observation
									} satisfies Partial<Context>
								}
							}
						},
						states: {
							active: {},
							interrupted: {
								initial: 'cancelled',
								states: {
									cancelled: { on: { CANCEL: {} } },
									scopeChanged: { on: { CANCEL: {}, INVALIDATE: {}, OBSERVE: {} } },
									closed: { on: { CANCEL: {}, INVALIDATE: {}, SHUTDOWN: {}, OBSERVE: {} } }
								}
							}
						}
					},
					flow: {
						initial: 'choosing',
						states: {
							choosing: {
								always: (args) => {
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'ready' }
									}
									if (args.context.draft?.action === 'remove') {
										return {
											target: 'ready',
											context: {
												prepared: { avatarData: null, avatarMimeType: null }
											} satisfies Partial<Context>
										}
									}
									return { target: 'processingImage' }
								}
							},
							processingImage: {
								on: {
									CANCEL: (args, enq) => {
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) return
										enq.sendTo('processImage', { type: 'CANCEL' })
									},
									INVALIDATE: (args, enq) => {
										if (
											!(
												!matchesState(
													{ running: { control: { interrupted: 'closed' } } },
													args.value
												) &&
												!matchesState(
													{ running: { control: { interrupted: 'scopeChanged' } } },
													args.value
												)
											)
										)
											return
										enq.sendTo('processImage', { type: 'CANCEL' })
									},
									SHUTDOWN: (args, enq) => {
										if (
											matchesState({ running: { control: { interrupted: 'closed' } } }, args.value)
										)
											return
										enq.sendTo('processImage', { type: 'SHUTDOWN' })
									}
								},
								invoke: model.createInvoke<typeof actors.processImage, Context>({
									id: 'processImage',
									src: actors.processImage,
									input: ({ context }) => {
										const draft = required(context.draft)
										if (draft.action !== 'upload') throw new Error('Missing avatar upload')
										return {
											file: draft.file,
											options: {
												maxWidth: 256,
												maxHeight: 256,
												mimeType: 'image/webp',
												quality: 0.85
											}
										}
									},
									onDone: (args) => {
										const { event } = args
										if (event.output?.outcome === 'processed') {
											return {
												target: 'validatingBytes',
												context: {
													blob:
														event.output?.outcome === 'processed' ? event.output.blob : undefined,
													bytes:
														event.output?.outcome === 'processed' ? event.output.bytes : undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'ready',
											context: patches.fail(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'ready',
											context: patches.fail(args) satisfies Partial<Context>
										}
									}
								})
							},
							validatingBytes: {
								invoke: model.createInvoke<typeof actors.validate, Context>({
									src: actors.validate,
									input: ({ context }) => ({
										bytes: required(context.bytes),
										mimeType: required(context.blob).type
									}),
									onDone: (args) => {
										const { event } = args
										if (event.output.success) {
											return {
												target: 'ready',
												context: {
													prepared: event.output.success ? event.output.data : undefined
												} satisfies Partial<Context>
											}
										}
										return {
											target: 'ready',
											context: patches.fail(args) satisfies Partial<Context>
										}
									},
									onError: (args) => {
										return {
											target: 'ready',
											context: patches.fail(args) satisfies Partial<Context>
										}
									}
								})
							},
							ready: {
								always: (args) => {
									if (matchesState({ running: { control: 'interrupted' } }, args.value)) {
										return { target: 'finishing' }
									}
									if (args.context.result !== undefined) {
										return { target: 'finishing' }
									}
									return { target: 'saving' }
								}
							},
							saving: {
								on: {
									CANCEL: (args, enq) => {
										if (matchesState({ running: { control: 'interrupted' } }, args.value)) return
										enq.sendTo('write', args.event)
									},
									INVALIDATE: (args, enq) => {
										if (
											!(
												!matchesState(
													{ running: { control: { interrupted: 'closed' } } },
													args.value
												) &&
												!matchesState(
													{ running: { control: { interrupted: 'scopeChanged' } } },
													args.value
												)
											)
										)
											return
										enq.sendTo('write', args.event)
									},
									SHUTDOWN: (args, enq) => {
										if (
											matchesState({ running: { control: { interrupted: 'closed' } } }, args.value)
										)
											return
										enq.sendTo('write', args.event)
									},
									OBSERVE: (args, enq) => {
										if (
											!(
												!matchesState(
													{ running: { control: { interrupted: 'closed' } } },
													args.value
												) &&
												!matchesState(
													{ running: { control: { interrupted: 'scopeChanged' } } },
													args.value
												)
											)
										)
											return
										const { event } = args
										enq.sendTo(
											'write',
											!options.sameScope(
												required(args.context.request).scope,
												options.scopeOf(event.observation.facts)
											)
												? { type: 'INVALIDATE' }
												: event
										)
									}
								},
								invoke: model.createInvoke<typeof actors.write, Context>({
									id: 'write',
									src: actors.write,
									input: ({ context }) => ({
										request: { ...required(context.request), values: required(context.prepared) },
										observation: required(context.observation)
									}),
									onDone: (args) => {
										return {
											target: 'finishing',
											context: {
												result: args.event.output ?? {
													outcome: 'failed',
													code: 'unexpected',
													settlement: 'unknown'
												}
											} satisfies Partial<Context>
										}
									},
									onError: (_args) => {
										return {
											target: 'finishing',
											context: {
												result: {
													outcome: 'failed',
													code: 'operationFailed',
													settlement: 'unknown'
												}
											} satisfies Partial<Context>
										}
									}
								})
							},
							finishing: {
								always: (args, enq) => {
									const { context } = args
									if (
										matchesState({ running: { control: { interrupted: 'closed' } } }, args.value)
									) {
										{
											return complete('closed', args, enq, { target: '#profile-avatar.closed' })
										}
									}
									if (
										matchesState(
											{ running: { control: { interrupted: 'scopeChanged' } } },
											args.value
										)
									) {
										{
											return complete('scopeChanged', args, enq, {
												target: '#profile-avatar.scopeChanged'
											})
										}
									}
									if (
										matchesState({ running: { control: { interrupted: 'cancelled' } } }, args.value)
									) {
										{
											return complete('cancelled', args, enq, {
												target: '#profile-avatar.cancelled'
											})
										}
									}
									if (context.result?.outcome === 'succeeded') {
										{
											return complete('succeeded', args, enq, {
												target: '#profile-avatar.succeeded'
											})
										}
									}
									if (context.result?.outcome === 'partial') {
										{
											return complete('partial', args, enq, { target: '#profile-avatar.partial' })
										}
									}
									if (context.result?.outcome === 'denied') {
										{
											return complete('denied', args, enq, { target: '#profile-avatar.denied' })
										}
									}
									if (context.result?.outcome === 'unavailable') {
										{
											return complete('unavailable', args, enq, {
												target: '#profile-avatar.unavailable'
											})
										}
									}
									if (context.result?.outcome === 'closed') {
										{
											return complete('closed', args, enq, { target: '#profile-avatar.closed' })
										}
									}
									if (context.result?.outcome === 'scopeChanged') {
										{
											return complete('scopeChanged', args, enq, {
												target: '#profile-avatar.scopeChanged'
											})
										}
									}
									if (context.result?.outcome === 'cancelled') {
										{
											return complete('cancelled', args, enq, {
												target: '#profile-avatar.cancelled'
											})
										}
									}
									{
										return complete('failed', args, enq, { target: '#profile-avatar.failed' })
									}
								}
							}
						}
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
			failed: {
				type: 'final'
			},
			closed: {
				type: 'final'
			},
			scopeChanged: {
				type: 'final'
			},
			cancelled: {
				type: 'final'
			}
		}
	})
}
