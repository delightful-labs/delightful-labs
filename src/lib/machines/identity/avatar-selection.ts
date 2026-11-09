import { types, setup, type SnapshotFrom } from 'xstate'

import type { EventPayload } from '../../contracts/machine-events.js'
export type AvatarSelectionObservation = {
	profileId: string
	resetRevision: number
	saved: File | null
}
export type AvatarCropRequest = Readonly<{
	file: File
}>
type Context = AvatarSelectionObservation & {
	selected: File | null
	candidate: File | undefined
	valid: boolean
	crop: AvatarCropRequest | undefined
}
type Event =
	| {
			type: 'OBSERVE'
			observation: AvatarSelectionObservation
	  }
	| {
			type: 'SELECT'
			file: File | null
	  }
	| {
			type: 'EDIT'
			file: File
	  }
	| {
			type: 'ACCEPT'
			crop: AvatarCropRequest
			file: File
	  }
	| {
			type: 'DISMISS'
			crop: AvatarCropRequest
	  }
	| {
			type: 'SHUTDOWN'
	  }
/** Synchronous selection owner; submitted image processing and saving have their own lifetime. */
export function createAvatarSelectionMachine(options: {
	validateFile: (file: File) => boolean
	onSelectionChange: (file: File | null) => void
	onRemove: () => void
}) {
	const patches = {
		validate: (args: { context: Context; event: Event }): Partial<Context> => ({
			valid: (({ context }: { context: Context }) => {
				try {
					return context.candidate !== undefined && options.validateFile(context.candidate)
				} catch {
					return false
				}
			})(args)
		}),
		beginCrop: (args: { context: Context; event: Event }): Partial<Context> => ({
			crop: (({ context }: { context: Context }) => {
				if (context.candidate === undefined) throw new Error('Missing avatar selection')
				return Object.freeze({ file: context.candidate })
			})(args),
			candidate: undefined
		}),
		clearCrop: (_args: { context: Context }): Partial<Context> => ({
			crop: undefined,
			candidate: undefined,
			valid: false
		})
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
				SELECT: types<EventPayload<Event, 'SELECT'>>(),
				EDIT: types<EventPayload<Event, 'EDIT'>>(),
				ACCEPT: types<EventPayload<Event, 'ACCEPT'>>(),
				DISMISS: types<EventPayload<Event, 'DISMISS'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
			},
			input: types<AvatarSelectionObservation>()
		},
		actions: {
			notifySelection: ({ context }: { context: Context }) =>
				options.onSelectionChange(context.selected),
			removeSaved: (_args: { context: Context }) => options.onRemove()
		}
	}).createMachine({
		id: 'avatar-selection',
		initial: 'active',
		context: ({ input }) => ({
			...input,
			selected: input.saved,
			candidate: undefined,
			valid: false,
			crop: undefined
		}),
		on: {
			SHUTDOWN: (_args) => {
				return {
					target: '.closed',
					context: {
						saved: null,
						selected: null,
						crop: undefined,
						candidate: undefined,
						valid: false
					} satisfies Partial<Context>
				}
			}
		},
		states: {
			active: {
				initial: 'ready',
				on: {
					OBSERVE: (args) => {
						const { context, event } = args
						if (
							context.profileId !== event.observation.profileId ||
							context.resetRevision !== event.observation.resetRevision
						) {
							let context = args.context
							let patch = {}
							patch = { ...patch, ...event.observation, selected: event.observation.saved }
							context = { ...args.context, ...patch }
							patch = { ...patch, ...patches.clearCrop({ ...args, context }) }
							context = { ...args.context, ...patch }
							return { target: '.ready', context: patch satisfies Partial<Context> }
						}
						if (context.selected === context.saved) {
							return {
								context: {
									saved: event.observation.saved,
									selected: event.observation.saved
								} satisfies Partial<Context>
							}
						}
						return {
							context: { saved: event.observation.saved } satisfies Partial<Context>
						}
					},
					SELECT: (args, enq) => {
						const { context, event } = args
						if (event.file !== null) {
							return {
								target: '.validating',
								context: {
									candidate: event.file ?? undefined,
									crop: undefined
								} satisfies Partial<Context>
							}
						}
						if (context.saved !== null && context.selected === context.saved) {
							let context = args.context
							let patch = {}
							patch = { ...patch, ...patches.clearCrop(args) }
							context = { ...args.context, ...patch }
							enq(args.actions.removeSaved, { ...args, context })
							return { target: '.ready', context: patch satisfies Partial<Context> }
						}
						{
							let context = args.context
							let patch = {}
							patch = { ...patch, selected: context.saved }
							context = { ...args.context, ...patch }
							patch = { ...patch, ...patches.clearCrop({ ...args, context }) }
							context = { ...args.context, ...patch }
							enq(args.actions.notifySelection, { ...args, context })
							return { target: '.ready', context: patch satisfies Partial<Context> }
						}
					},
					EDIT: (args) => {
						return {
							target: '.cropping',
							context: { candidate: args.event.file } satisfies Partial<Context>
						}
					}
				},
				states: {
					ready: {},
					validating: {
						entry: (args) => {
							return { context: patches.validate(args) satisfies Partial<Context> }
						},
						always: (args, enq) => {
							const { context } = args
							if (context.valid) {
								return { target: 'cropping' }
							}
							{
								let context = args.context
								let patch = {}
								patch = { ...patch, selected: context.saved }
								context = { ...args.context, ...patch }
								patch = { ...patch, ...patches.clearCrop({ ...args, context }) }
								context = { ...args.context, ...patch }
								enq(args.actions.notifySelection, { ...args, context })
								return {
									target: 'invalid',
									context: patch satisfies Partial<Context>
								}
							}
						}
					},
					invalid: { tags: ['invalid'] },
					cropping: {
						entry: (args) => {
							return { context: patches.beginCrop(args) satisfies Partial<Context> }
						},
						exit: (args) => {
							return { context: patches.clearCrop(args) satisfies Partial<Context> }
						},
						on: {
							ACCEPT: (args, enq) => {
								const { event } = args
								if (!(args.context.crop === event.crop)) return
								let context = args.context
								let patch = {}
								patch = { ...patch, selected: event.file }
								context = { ...args.context, ...patch }
								enq(args.actions.notifySelection, { ...args, context })
								return { target: 'ready', context: patch satisfies Partial<Context> }
							},
							DISMISS: (args) => {
								if (!(args.context.crop === args.event.crop)) return
								return { target: 'ready' }
							}
						}
					}
				}
			},
			closed: { type: 'final' }
		}
	})
}
export function selectAvatarSelection(
	snapshot: SnapshotFrom<ReturnType<typeof createAvatarSelectionMachine>>
) {
	return {
		selected: snapshot.context.selected,
		crop: snapshot.context.crop,
		invalid: snapshot.hasTag('invalid'),
		dirty:
			snapshot.context.selected !== null && snapshot.context.selected !== snapshot.context.saved
	}
}
