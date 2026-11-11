import type { PicaCanvas } from 'pica'
import * as image from '#lib/domain/image-processing.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type ImageProcessingInput = { file: File; options: image.ImageProcessingOptions }
export type ImageProcessingOutput =
	| { outcome: 'processed'; blob: Blob; bytes: Uint8Array; dimensions: image.ImageDimensions }
	| { outcome: 'failed' }
type Context = ImageProcessingInput & {
	bitmap: ImageBitmap | undefined
	canvas: PicaCanvas | undefined
	blob: Blob | undefined
	bytes: Uint8Array | undefined
	dimensions: image.ImageDimensions | undefined
	interrupted: boolean
	output: ImageProcessingOutput | undefined
}
type Event = { type: 'CANCEL' | 'SHUTDOWN' }

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing image processing resource')
	return value
}
const ownedActors1 = {
	decode: createAsyncLogic({ run: ({ input }: { input: File }) => image.decodeImage(input) }),
	initialize: createAsyncLogic({ run: async () => image.initializeImageResizer() }),
	canvas: createAsyncLogic({
		run: async ({
			input
		}: {
			input: { bitmap: ImageBitmap; options: image.ImageProcessingOptions }
		}) => image.createImageCanvas(input.bitmap, input.options)
	}),
	resize: createAsyncLogic({
		run: ({ input }: { input: { bitmap: ImageBitmap; canvas: PicaCanvas } }) =>
			image.resizeImage(input.bitmap, input.canvas)
	}),
	encode: createAsyncLogic({
		run: ({ input }: { input: { canvas: PicaCanvas; options: image.ImageProcessingOptions } }) =>
			image.encodeImage(input.canvas, input.options)
	}),
	read: createAsyncLogic({ run: ({ input }: { input: Blob }) => image.readImageBytes(input) }),
	closeBitmap: createAsyncLogic({
		run: async ({ input }: { input: ImageBitmap }) => image.releaseImageBitmap(input)
	}),
	closeCanvas: createAsyncLogic({
		run: async ({ input }: { input: PicaCanvas }) => image.releaseImageCanvas(input)
	})
}
const patchProcessed = ({ context }: { context: Context }): Partial<Context> => ({
	output:
		context.blob && context.bytes && context.dimensions
			? {
					outcome: 'processed',
					blob: context.blob,
					bytes: context.bytes,
					dimensions: context.dimensions
				}
			: { outcome: 'failed' }
})
const patchFail = (): Partial<Context> => ({ output: { outcome: 'failed' } })
const patchInterrupt = (): Partial<Context> => ({ interrupted: true })
const events0 = {
	CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof ownedActors1)['decode']>
			| import('xstate').OutputFrom<(typeof ownedActors1)['initialize']>
			| import('xstate').OutputFrom<(typeof ownedActors1)['canvas']>
			| import('xstate').OutputFrom<(typeof ownedActors1)['resize']>
			| import('xstate').OutputFrom<(typeof ownedActors1)['encode']>
			| import('xstate').OutputFrom<(typeof ownedActors1)['read']>
			| import('xstate').OutputFrom<(typeof ownedActors1)['closeBitmap']>
			| import('xstate').OutputFrom<(typeof ownedActors1)['closeCanvas']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Decodes, resizes, encodes, reads, and releases resources for one image. */
export const imageProcessingMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<ImageProcessingInput>(),
		output: types<ImageProcessingOutput>(),
		children: {
			decode: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['decode']>>(),
			initialize: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['initialize']>>(),
			canvas: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['canvas']>>(),
			resize: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['resize']>>(),
			encode: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['encode']>>(),
			read: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['read']>>(),
			closeBitmap: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['closeBitmap']>>(),
			closeCanvas: types<import('xstate').ActorRefFrom<(typeof ownedActors1)['closeCanvas']>>()
		}
	},
	actors: ownedActors1,
	actions: {}
}).createMachine({
	id: 'image-processing',
	initial: 'decoding',
	context: ({ input }) => ({
		...input,
		bitmap: undefined,
		canvas: undefined,
		blob: undefined,
		bytes: undefined,
		dimensions: undefined,
		interrupted: false,
		output: undefined
	}),
	output: ({ context }) => context.output ?? { outcome: 'failed' },
	on: {
		CANCEL: (args) => {
			return { context: patchInterrupt() }
		},
		SHUTDOWN: (args) => {
			return { context: patchInterrupt() }
		}
	},
	states: {
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => context.file,
				onDone: (args) => {
					const { event } = args
					if (args.context.interrupted) {
						return { target: 'cleanup', context: { bitmap: event.output } }
					}
					return { target: 'initializing', context: { bitmap: event.output } }
				},
				onError: (args) => {
					return { target: 'failed', context: patchFail() }
				}
			}
		},
		initializing: {
			invoke: {
				src: 'initialize',
				onDone: (args) => {
					if (args.context.interrupted) {
						return { target: 'cleanup' }
					}
					return { target: 'creatingCanvas' }
				},
				onError: (args) => {
					return { target: 'cleanup', context: patchFail() }
				}
			}
		},
		creatingCanvas: {
			invoke: {
				src: 'canvas',
				input: ({ context }) => ({ bitmap: required(context.bitmap), options: context.options }),
				onDone: (args) => {
					const { event } = args
					if (args.context.interrupted) {
						return { target: 'cleanup', context: { canvas: event.output } }
					}
					return {
						target: 'resizing',
						context: {
							canvas: event.output,
							dimensions: {
								width: event.output.width,
								height: event.output.height
							}
						}
					}
				},
				onError: (args) => {
					return { target: 'cleanup', context: patchFail() }
				}
			}
		},
		resizing: {
			invoke: {
				src: 'resize',
				input: ({ context }) => ({
					bitmap: required(context.bitmap),
					canvas: required(context.canvas)
				}),
				onDone: (args) => {
					if (args.context.interrupted) {
						return { target: 'cleanup' }
					}
					return { target: 'encoding' }
				},
				onError: (args) => {
					return { target: 'cleanup', context: patchFail() }
				}
			}
		},
		encoding: {
			invoke: {
				src: 'encode',
				input: ({ context }) => ({ canvas: required(context.canvas), options: context.options }),
				onDone: (args) => {
					const { event } = args
					if (args.context.interrupted) {
						return { target: 'cleanup', context: { blob: event.output ?? undefined } }
					}
					if (event.output instanceof Blob) {
						return { target: 'reading', context: { blob: event.output ?? undefined } }
					}
					return { target: 'cleanup', context: patchFail() }
				},
				onError: (args) => {
					return { target: 'cleanup', context: patchFail() }
				}
			}
		},
		reading: {
			invoke: {
				src: 'read',
				input: ({ context }) => required(context.blob),
				onDone: (args) => {
					return { target: 'cleanup', context: { bytes: args.event.output } }
				},
				onError: (args) => {
					return { target: 'cleanup', context: patchFail() }
				}
			}
		},
		cleanup: {
			initial: 'bitmap',
			onDone: { target: 'settling' },
			states: {
				bitmap: {
					always: (args) => {
						if (args.context.bitmap !== undefined) {
							return { target: 'closingBitmap' }
						}
						return { target: 'canvas' }
					}
				},
				closingBitmap: {
					invoke: {
						src: 'closeBitmap',
						input: ({ context }) => required(context.bitmap),
						onDone: () => {
							return { target: 'canvas', context: { bitmap: undefined } }
						},
						onError: (args) => {
							return { target: 'canvas', context: { ...patchFail(), bitmap: undefined } }
						}
					}
				},
				canvas: {
					always: (args) => {
						if (args.context.canvas !== undefined) {
							return { target: 'closingCanvas' }
						}
						return { target: 'done' }
					}
				},
				closingCanvas: {
					invoke: {
						src: 'closeCanvas',
						input: ({ context }) => required(context.canvas),
						onDone: () => {
							return { target: 'done', context: { canvas: undefined } }
						},
						onError: (args) => {
							return { target: 'done', context: { ...patchFail(), canvas: undefined } }
						}
					}
				},
				done: { type: 'final' }
			}
		},
		settling: {
			always: (args) => {
				const { context } = args
				if (context.output?.outcome === 'failed') {
					return { target: 'failed' }
				}
				if (context.interrupted) {
					return { target: 'failed', context: patchFail() }
				}
				return { target: 'completed', context: patchProcessed(args) }
			}
		},
		completed: { type: 'final' },
		failed: { type: 'final' }
	}
})
