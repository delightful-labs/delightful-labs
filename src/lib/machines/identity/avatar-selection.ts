import { assign, setup, type SnapshotFrom } from 'xstate'

export type AvatarSelectionObservation = {
	profileId: string
	resetRevision: number
	saved: File | null
}
export type AvatarCropRequest = Readonly<{ file: File }>
type Context = AvatarSelectionObservation & {
	selected: File | null
	candidate: File | undefined
	valid: boolean
	crop: AvatarCropRequest | undefined
}
type Event =
	| { type: 'OBSERVE'; observation: AvatarSelectionObservation }
	| { type: 'SELECT'; file: File | null }
	| { type: 'EDIT'; file: File }
	| { type: 'ACCEPT'; crop: AvatarCropRequest; file: File }
	| { type: 'DISMISS'; crop: AvatarCropRequest }
	| { type: 'SHUTDOWN' }

/** Synchronous selection owner; submitted image processing and saving have their own lifetime. */
export function createAvatarSelectionMachine(options: {
	validateFile: (file: File) => boolean
	onSelectionChange: (file: File | null) => void
	onRemove: () => void
}) {
	return setup<
		Context,
		Event,
		{},
		{},
		{
			validate: undefined
			beginCrop: undefined
			clearCrop: undefined
			notifySelection: undefined
			removeSaved: undefined
		},
		{},
		never,
		string,
		AvatarSelectionObservation
	>({
		actions: {
			validate: assign({
				valid: ({ context }) => {
					try {
						return context.candidate !== undefined && options.validateFile(context.candidate)
					} catch {
						return false
					}
				}
			}),
			beginCrop: assign({
				crop: ({ context }) => {
					if (context.candidate === undefined) throw new Error('Missing avatar selection')
					return Object.freeze({ file: context.candidate })
				},
				candidate: undefined
			}),
			clearCrop: assign({ crop: undefined, candidate: undefined, valid: false }),
			notifySelection: ({ context }) => options.onSelectionChange(context.selected),
			removeSaved: () => options.onRemove()
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
			SHUTDOWN: {
				target: '.closed',
				actions: assign({
					saved: null,
					selected: null,
					crop: undefined,
					candidate: undefined,
					valid: false
				})
			}
		},
		states: {
			active: {
				initial: 'ready',
				on: {
					OBSERVE: [
						{
							guard: ({ context, event }) =>
								context.profileId !== event.observation.profileId ||
								context.resetRevision !== event.observation.resetRevision,
							target: '.ready',
							actions: [
								assign(({ event }) => ({
									...event.observation,
									selected: event.observation.saved
								})),
								'clearCrop'
							]
						},
						{
							guard: ({ context }) => context.selected === context.saved,
							actions: assign(({ event }) => ({
								saved: event.observation.saved,
								selected: event.observation.saved
							}))
						},
						{ actions: assign({ saved: ({ event }) => event.observation.saved }) }
					],
					SELECT: [
						{
							guard: ({ event }) => event.file !== null,
							target: '.validating',
							actions: assign({
								candidate: ({ event }) => event.file ?? undefined,
								crop: undefined
							})
						},
						{
							guard: ({ context }) => context.saved !== null && context.selected === context.saved,
							target: '.ready',
							actions: ['clearCrop', 'removeSaved']
						},
						{
							target: '.ready',
							actions: [
								assign({ selected: ({ context }) => context.saved }),
								'clearCrop',
								'notifySelection'
							]
						}
					],
					EDIT: { target: '.cropping', actions: assign({ candidate: ({ event }) => event.file }) }
				},
				states: {
					ready: {},
					validating: {
						entry: 'validate',
						always: [
							{ guard: ({ context }) => context.valid, target: 'cropping' },
							{
								target: 'invalid',
								actions: [
									assign({ selected: ({ context }) => context.saved }),
									'clearCrop',
									'notifySelection'
								]
							}
						]
					},
					invalid: { tags: 'invalid' },
					cropping: {
						entry: 'beginCrop',
						exit: 'clearCrop',
						on: {
							ACCEPT: {
								guard: ({ context, event }) => context.crop === event.crop,
								target: 'ready',
								actions: [assign({ selected: ({ event }) => event.file }), 'notifySelection']
							},
							DISMISS: {
								guard: ({ context, event }) => context.crop === event.crop,
								target: 'ready'
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
