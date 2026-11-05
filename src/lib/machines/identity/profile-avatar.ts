import {
	forwardTo,
	sendTo,
	and,
	not,
	assign,
	fromPromise,
	setup,
	stateIn,
	type ActorLogic,
	type Snapshot
} from 'xstate'
import type {
	FormChildEvent,
	FormInterruption,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '../../contracts/scoped-form.js'
import type { ProfileObservation, ProfileReason, ProfileScope } from '../../contracts/profile.js'
export type ProfileAvatarDraft = { action: 'upload'; file: File } | { action: 'remove' }
export type ProfileAvatarValues =
	| {
			avatarData: Uint8Array<ArrayBuffer>
			avatarMimeType: 'image/png' | 'image/jpeg' | 'image/webp'
	  }
	| { avatarData: null; avatarMimeType: null }
export type ProfileImageResult =
	| {
			outcome: 'processed'
			blob: Blob
			bytes: Uint8Array
			dimensions: { width: number; height: number }
	  }
	| { outcome: 'failed' }
export type ProfileImageLogic<S extends Snapshot<ProfileImageResult>> = ActorLogic<
	S,
	{ type: 'CANCEL' | 'SHUTDOWN' },
	{
		file: File
		options: { maxWidth: number; maxHeight: number; mimeType: 'image/webp'; quality: number }
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
	validateBytes: (input: {
		bytes: Uint8Array
		mimeType: string
	}) => { success: true; data: Values } | { success: false }
	write: ProfileAvatarWriteLogic<WriteSnapshot>
	scopeOf: (facts: ProfileObservation) => ProfileScope
	sameScope: (left: ProfileScope, right: ProfileScope) => boolean
}) {
	const actors = {
		processImage: options.processImage,
		validate: fromPromise(async ({ input }: { input: { bytes: Uint8Array; mimeType: string } }) =>
			options.validateBytes(input)
		),
		write: options.write
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ fail: undefined },
		{
			interrupted: undefined
			closing: undefined
			invalidated: undefined
			cancelling: undefined
		},
		never,
		string,
		Input,
		Result
	>({
		actors,
		actions: { fail: assign({ result: (): Result => failed }) },
		guards: {
			interrupted: stateIn({ running: { control: 'interrupted' } }),
			closing: stateIn({ running: { control: { interrupted: 'closed' } } }),
			invalidated: stateIn({ running: { control: { interrupted: 'scopeChanged' } } }),
			cancelling: stateIn({ running: { control: { interrupted: 'cancelled' } } })
		}
	})
	const observe = model.assign({
		observation: ({ context, event }) =>
			event.type === 'OBSERVE' ? event.observation : context.observation
	})
	const clear = model.assign({
		request: undefined,
		draft: undefined,
		observation: undefined,
		blob: undefined,
		bytes: undefined,
		prepared: undefined
	})
	const terminal = (outcome?: FormInterruption) =>
		model.createStateConfig({
			type: 'final',
			entry: [
				model.assign({
					result: ({ context }): Result =>
						outcome
							? { outcome, settlement: context.result?.settlement ?? 'notStarted' }
							: (context.result ?? failed)
				}),
				clear
			]
		})
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
							OBSERVE: [
								{
									guard: ({ context, event }) =>
										!options.sameScope(
											required(context.request).scope,
											options.scopeOf(event.observation.facts)
										),
									target: '.interrupted.scopeChanged',
									actions: observe
								},
								{ actions: observe }
							]
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
								always: [
									{ guard: 'interrupted', target: 'ready' },
									{
										guard: ({ context }) => context.draft?.action === 'remove',
										target: 'ready',
										actions: assign({
											prepared: () => ({ avatarData: null, avatarMimeType: null })
										})
									},
									{ target: 'processingImage' }
								]
							},
							processingImage: {
								on: {
									CANCEL: {
										guard: not('interrupted'),
										actions: sendTo('processImage', { type: 'CANCEL' })
									},
									INVALIDATE: {
										guard: and([not('closing'), not('invalidated')]),
										actions: sendTo('processImage', { type: 'CANCEL' })
									},
									SHUTDOWN: {
										guard: not('closing'),
										actions: sendTo('processImage', { type: 'SHUTDOWN' })
									}
								},

								invoke: {
									id: 'processImage',
									src: 'processImage',
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
									onDone: [
										{
											guard: ({ event }) => event.output?.outcome === 'processed',
											target: 'validatingBytes',
											actions: assign({
												blob: ({ event }) =>
													event.output?.outcome === 'processed' ? event.output.blob : undefined,
												bytes: ({ event }) =>
													event.output?.outcome === 'processed' ? event.output.bytes : undefined
											})
										},
										{ target: 'ready', actions: 'fail' }
									],
									onError: { target: 'ready', actions: 'fail' }
								}
							},
							validatingBytes: {
								invoke: {
									src: 'validate',
									input: ({ context }) => ({
										bytes: required(context.bytes),
										mimeType: required(context.blob).type
									}),
									onDone: [
										{
											guard: ({ event }) => event.output.success,
											target: 'ready',
											actions: assign({
												prepared: ({ event }) =>
													event.output.success ? event.output.data : undefined
											})
										},
										{ target: 'ready', actions: 'fail' }
									],
									onError: { target: 'ready', actions: 'fail' }
								}
							},
							ready: {
								always: [
									{ guard: 'interrupted', target: 'finishing' },
									{ guard: ({ context }) => context.result !== undefined, target: 'finishing' },
									{ target: 'saving' }
								]
							},
							saving: {
								on: {
									CANCEL: { guard: not('interrupted'), actions: forwardTo('write') },
									INVALIDATE: {
										guard: and([not('closing'), not('invalidated')]),
										actions: forwardTo('write')
									},
									SHUTDOWN: { guard: not('closing'), actions: forwardTo('write') },
									OBSERVE: {
										guard: and([not('closing'), not('invalidated')]),
										actions: sendTo('write', ({ context, event }) =>
											!options.sameScope(
												required(context.request).scope,
												options.scopeOf(event.observation.facts)
											)
												? { type: 'INVALIDATE' }
												: event
										)
									}
								},

								invoke: {
									id: 'write',
									src: 'write',
									input: ({ context }) => ({
										request: { ...required(context.request), values: required(context.prepared) },
										observation: required(context.observation)
									}),
									onDone: {
										target: 'finishing',
										actions: assign({
											result: ({ event }) =>
												event.output ?? {
													outcome: 'failed',
													code: 'unexpected',
													settlement: 'unknown'
												}
										})
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: () => ({
												outcome: 'failed',
												code: 'operationFailed',
												settlement: 'unknown'
											})
										})
									}
								}
							},
							finishing: {
								always: [
									{ guard: 'closing', target: '#profile-avatar.closed' },
									{ guard: 'invalidated', target: '#profile-avatar.scopeChanged' },
									{ guard: 'cancelling', target: '#profile-avatar.cancelled' },
									{
										guard: ({ context }) => context.result?.outcome === 'succeeded',
										target: '#profile-avatar.succeeded'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'partial',
										target: '#profile-avatar.partial'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'denied',
										target: '#profile-avatar.denied'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'unavailable',
										target: '#profile-avatar.unavailable'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'closed',
										target: '#profile-avatar.closed'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'scopeChanged',
										target: '#profile-avatar.scopeChanged'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'cancelled',
										target: '#profile-avatar.cancelled'
									},
									{ target: '#profile-avatar.failed' }
								]
							}
						}
					}
				}
			},
			succeeded: terminal(),
			partial: terminal(),
			denied: terminal(),
			unavailable: terminal(),
			failed: terminal(),
			closed: terminal('closed'),
			scopeChanged: terminal('scopeChanged'),
			cancelled: terminal('cancelled')
		}
	})
}
