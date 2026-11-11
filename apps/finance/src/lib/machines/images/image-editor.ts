import {
	initialImageSelection,
	moveImageSelection,
	selectionQuad,
	validImageQuad,
	type ImageCorner,
	type ImagePoint,
	type ImageSelection,
	type ImageSelectionMode
} from '#lib/domain/image-editor-geometry.js'
import { renderEditorPixels, type ImageAdjustments } from '#lib/domain/image-editor-pixels.js'
import * as platform from '#lib/domain/image-editor-platform.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type ImageEditorInput = { file: File; mode?: ImageSelectionMode }
export type ImageEditorOutput =
	| { kind: 'applied'; file: File }
	| { kind: 'cancelled' | 'closed' }
	| { kind: 'failed'; reason: 'input' | 'decode' | 'read' | 'render' | 'encode' | 'cleanup' }
type DragTarget = { kind: 'move' } | { kind: 'corner'; corner: ImageCorner }
type DragOrigin = { point: ImagePoint; selection: ImageSelection; target: DragTarget }
export type ImageEditorEvent =
	| { type: 'BEGIN_DRAG'; point: ImagePoint; target: DragTarget }
	| { type: 'DRAG'; point: ImagePoint }
	| { type: 'END_DRAG' }
	| { type: 'NUDGE'; delta: ImagePoint; target: DragTarget }
	| { type: 'SET_MODE'; mode: ImageSelectionMode }
	| { type: 'SET_CONTRAST'; value: number }
	| { type: 'SET_BLACK_WHITE'; value: boolean }
	| { type: 'PREVIEW' | 'EDIT' | 'RESET' | 'APPLY' | 'CANCEL' | 'SHUTDOWN' | 'DISPLAY_FAILED' }
type Context = {
	file: File
	mode: ImageSelectionMode
	bitmap: ImageBitmap | undefined
	source: ImageData | undefined
	selection: ImageSelection | undefined
	adjustments: ImageAdjustments
	drag: DragOrigin | undefined
	preview: ImageData | undefined
	rendered: ImageData | undefined
	canvas: HTMLCanvasElement | undefined
	result: ImageEditorOutput | undefined
}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing image editor resource')
	return value
}
function failed(
	context: Context,
	reason: Extract<ImageEditorOutput, { kind: 'failed' }>['reason']
): ImageEditorOutput {
	return context.result && context.result.kind !== 'applied'
		? context.result
		: { kind: 'failed', reason }
}
function cancelled(context: Context): ImageEditorOutput {
	return context.result?.kind === 'closed' ? context.result : { kind: 'cancelled' }
}
function renderInput(context: Context) {
	return {
		source: required(context.source),
		selection: required(context.selection),
		adjustments: context.adjustments
	}
}
function nudge(context: Context, target: DragTarget, delta: ImagePoint) {
	return moveImageSelection(
		required(context.selection),
		{ ...target, delta },
		required(context.source)
	)
}

const decode = createAsyncLogic({
	run: ({ input }: { input: File }) => platform.decodeEditorImage(input)
})
const read = createAsyncLogic({
	run: async ({ input }: { input: ImageBitmap }) => platform.readEditorSource(input)
})
const render = createAsyncLogic({
	run: async ({ input }: { input: ReturnType<typeof renderInput> }) =>
		renderEditorPixels(input.source, input.selection, input.adjustments)
})
const allocate = createAsyncLogic({ run: async () => platform.createEditorCanvas() })
const paint = createAsyncLogic({
	run: async ({ input }: { input: { canvas: HTMLCanvasElement; pixels: ImageData } }) =>
		platform.paintEditorCanvas(input.canvas, input.pixels)
})
const encode = createAsyncLogic({
	run: ({ input }: { input: { canvas: HTMLCanvasElement; mimeType: string } }) =>
		platform.encodeEditorCanvas(input.canvas, input.mimeType)
})
const closeBitmap = createAsyncLogic({
	run: async ({ input }: { input: ImageBitmap }) => input.close()
})
const closeCanvas = createAsyncLogic({
	run: async ({ input }: { input: HTMLCanvasElement }) => platform.releaseEditorCanvas(input)
})
const patchShutdown = (): Partial<Context> => ({ result: { kind: 'closed' } })
const patchCancel = ({ context }: { context: Context }): Partial<Context> => ({
	result: cancelled(context)
})
const events0 = {
	BEGIN_DRAG: types<EventPayload<ImageEditorEvent, 'BEGIN_DRAG'>>(),
	DRAG: types<EventPayload<ImageEditorEvent, 'DRAG'>>(),
	END_DRAG: types<EventPayload<ImageEditorEvent, 'END_DRAG'>>(),
	NUDGE: types<EventPayload<ImageEditorEvent, 'NUDGE'>>(),
	SET_MODE: types<EventPayload<ImageEditorEvent, 'SET_MODE'>>(),
	SET_CONTRAST: types<EventPayload<ImageEditorEvent, 'SET_CONTRAST'>>(),
	SET_BLACK_WHITE: types<EventPayload<ImageEditorEvent, 'SET_BLACK_WHITE'>>(),
	PREVIEW: types<EventPayload<ImageEditorEvent, 'PREVIEW'>>(),
	EDIT: types<EventPayload<ImageEditorEvent, 'EDIT'>>(),
	RESET: types<EventPayload<ImageEditorEvent, 'RESET'>>(),
	APPLY: types<EventPayload<ImageEditorEvent, 'APPLY'>>(),
	CANCEL: types<EventPayload<ImageEditorEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<ImageEditorEvent, 'SHUTDOWN'>>(),
	DISPLAY_FAILED: types<EventPayload<ImageEditorEvent, 'DISPLAY_FAILED'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof decode>
			| import('xstate').OutputFrom<typeof read>
			| import('xstate').OutputFrom<typeof render>
			| import('xstate').OutputFrom<typeof allocate>
			| import('xstate').OutputFrom<typeof paint>
			| import('xstate').OutputFrom<typeof encode>
			| import('xstate').OutputFrom<typeof closeBitmap>
			| import('xstate').OutputFrom<typeof closeCanvas>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Owns editing and export resources; callers drain SHUTDOWN before stopping the actor. */
export const imageEditorMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<ImageEditorInput>(),
		output: types<ImageEditorOutput>(),
		children: {
			decode: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['decode']
				>
			>(),
			read: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['read']
				>
			>(),
			render: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['render']
				>
			>(),
			allocate: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['allocate']
				>
			>(),
			paint: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['paint']
				>
			>(),
			encode: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['encode']
				>
			>(),
			closeBitmap: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['closeBitmap']
				>
			>(),
			closeCanvas: types<
				import('xstate').ActorRefFrom<
					{
						decode: typeof decode
						read: typeof read
						render: typeof render
						allocate: typeof allocate
						paint: typeof paint
						encode: typeof encode
						closeBitmap: typeof closeBitmap
						closeCanvas: typeof closeCanvas
					}['closeCanvas']
				>
			>()
		}
	},
	actors: { decode, read, render, allocate, paint, encode, closeBitmap, closeCanvas },
	actions: {}
}).createMachine({
	id: 'image-editor',
	initial: 'validating',
	context: ({ input }) => ({
		file: input.file,
		mode: input.mode ?? 'perspective',
		bitmap: undefined,
		source: undefined,
		selection: undefined,
		adjustments: { blackWhite: false, contrast: 100 },
		drag: undefined,
		preview: undefined,
		rendered: undefined,
		canvas: undefined,
		result: undefined
	}),
	output: ({ context }) => context.result ?? { kind: 'failed', reason: 'input' },
	// Pending native operations retain their invocation until settlement. Completion
	// transitions consume this requested terminal result before starting another operation.
	on: {
		CANCEL: (args) => {
			return { context: patchCancel(args) }
		},
		SHUTDOWN: (args) => {
			return { context: patchShutdown() }
		}
	},
	states: {
		validating: {
			always: (args) => {
				const { context } = args
				if (
					context.file.size > 0 &&
					['image/png', 'image/jpeg', 'image/webp'].includes(context.file.type)
				) {
					return { target: 'decoding' }
				}
				return { target: 'failed', context: { result: { kind: 'failed', reason: 'input' } } }
			}
		},
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => context.file,
				onDone: (args) => {
					const { event } = args
					if (args.context.result !== undefined) {
						return { target: 'cleanup', context: { bitmap: event.output } }
					}
					return { target: 'readingSource', context: { bitmap: event.output } }
				},
				onError: (args) => {
					const { context } = args
					return { target: 'cleanup', context: { result: failed(context, 'decode') } }
				}
			}
		},
		readingSource: {
			invoke: {
				src: 'read',
				input: ({ context }) => required(context.bitmap),
				onDone: (args) => {
					const { context, event } = args
					if (context.result !== undefined) {
						return { target: 'cleanup' }
					}
					return {
						target: 'closingSource',
						context: {
							source: event.output,
							selection: initialImageSelection(context.mode, event.output)
						}
					}
				},
				onError: (args) => {
					const { context } = args
					return { target: 'cleanup', context: { result: failed(context, 'read') } }
				}
			}
		},
		closingSource: {
			invoke: {
				src: 'closeBitmap',
				input: ({ context }) => required(context.bitmap),
				onDone: (args) => {
					if (args.context.result !== undefined) {
						return { target: 'cleanup', context: { bitmap: undefined } }
					}
					return { target: 'interactive', context: { bitmap: undefined } }
				},
				onError: (args) => {
					const { context } = args
					return {
						target: 'cleanup',
						context: { bitmap: undefined, result: failed(context, 'cleanup') }
					}
				}
			}
		},
		interactive: {
			initial: 'editing',
			on: {
				DISPLAY_FAILED: (args) => {
					const { context } = args
					return { target: 'cleanup', context: { result: failed(context, 'render') } }
				},
				CANCEL: (args) => {
					return { target: 'cleanup', context: patchCancel(args) }
				},
				SHUTDOWN: (args) => {
					return { target: 'cleanup', context: patchShutdown() }
				},
				SET_MODE: (args) => {
					const { event } = args
					return {
						target: '.editing.idle',
						context: {
							mode: event.mode,
							selection: initialImageSelection(event.mode, required(args.context.source)),
							drag: undefined,
							preview: undefined
						}
					}
				},
				SET_CONTRAST: (args) => {
					const { event } = args
					if (!Number.isFinite(event.value)) return
					return {
						target: '.editing.idle',
						context: {
							adjustments: {
								...args.context.adjustments,
								contrast: Math.max(0, Math.min(200, event.value))
							},
							drag: undefined,
							preview: undefined
						}
					}
				},
				SET_BLACK_WHITE: (args) => {
					return {
						target: '.editing.idle',
						context: {
							adjustments: {
								...args.context.adjustments,
								blackWhite: args.event.value
							},
							drag: undefined,
							preview: undefined
						}
					}
				},
				RESET: (args) => {
					const { context } = args
					return {
						target: '.editing.idle',
						context: {
							selection: initialImageSelection(context.mode, required(context.source)),
							adjustments: { blackWhite: false, contrast: 100 },
							drag: undefined,
							preview: undefined
						}
					}
				},
				APPLY: (args) => {
					const { context } = args
					if (!validImageQuad(selectionQuad(required(context.selection)), required(context.source)))
						return
					return { target: 'renderingApply', context: { drag: undefined, preview: undefined } }
				}
			},
			states: {
				editing: {
					initial: 'idle',
					on: {
						PREVIEW: () => {
							return {
								target: '#image-editor.interactive.renderingPreview',
								context: { drag: undefined }
							}
						},
						NUDGE: (args) => {
							const { context, event } = args
							return {
								target: '.idle',
								context: { selection: nudge(context, event.target, event.delta), drag: undefined }
							}
						}
					},
					states: {
						idle: {
							on: {
								BEGIN_DRAG: (args) => {
									const { event } = args
									if (!(Number.isFinite(event.point.x) && Number.isFinite(event.point.y))) return
									return {
										target: 'dragging',
										context: {
											drag: {
												point: event.point,
												target: event.target,
												selection: required(args.context.selection)
											}
										}
									}
								}
							}
						},
						dragging: {
							on: {
								DRAG: (args) => {
									return {
										context: {
											selection: (({ context, event }) => {
												const origin = required(context.drag)
												return moveImageSelection(
													origin.selection,
													{
														...origin.target,
														delta: {
															x: event.point.x - origin.point.x,
															y: event.point.y - origin.point.y
														}
													},
													required(context.source)
												)
											})(args)
										}
									}
								},
								END_DRAG: () => {
									return { target: 'idle', context: { drag: undefined } }
								}
							}
						}
					}
				},
				renderingPreview: {
					invoke: {
						src: 'render',
						input: ({ context }) => renderInput(context),
						onDone: (args) => {
							return { target: 'previewReady', context: { preview: args.event.output } }
						},
						onError: (args) => {
							const { context } = args
							return {
								target: '#image-editor.cleanup',
								context: { result: failed(context, 'render') }
							}
						}
					}
				},
				previewReady: {
					on: {
						EDIT: () => {
							return { target: 'editing', context: { preview: undefined } }
						}
					}
				}
			}
		},
		renderingApply: {
			invoke: {
				src: 'render',
				input: ({ context }) => renderInput(context),
				onDone: (args) => {
					if (args.context.result !== undefined) {
						return { target: 'cleanup' }
					}
					return { target: 'creatingCanvas', context: { rendered: args.event.output } }
				},
				onError: (args) => {
					const { context } = args
					return { target: 'cleanup', context: { result: failed(context, 'render') } }
				}
			}
		},
		creatingCanvas: {
			invoke: {
				src: 'allocate',
				onDone: (args) => {
					const { event } = args
					if (args.context.result !== undefined) {
						return { target: 'cleanup', context: { canvas: event.output } }
					}
					return { target: 'painting', context: { canvas: event.output } }
				},
				onError: (args) => {
					const { context } = args
					return { target: 'cleanup', context: { result: failed(context, 'render') } }
				}
			}
		},
		painting: {
			invoke: {
				src: 'paint',
				input: ({ context }) => ({
					canvas: required(context.canvas),
					pixels: required(context.rendered)
				}),
				onDone: (args) => {
					if (args.context.result !== undefined) {
						return { target: 'cleanup' }
					}
					return { target: 'encoding' }
				},
				onError: (args) => {
					const { context } = args
					return { target: 'cleanup', context: { result: failed(context, 'render') } }
				}
			}
		},
		encoding: {
			invoke: {
				src: 'encode',
				input: ({ context }) => ({ canvas: required(context.canvas), mimeType: context.file.type }),
				onDone: (args) => {
					const { context, event } = args
					if (context.result !== undefined) {
						return { target: 'cleanup' }
					}
					if (
						event.output !== null &&
						event.output.size > 0 &&
						event.output.type === context.file.type
					) {
						return {
							target: 'cleanup',
							context: {
								result: {
									kind: 'applied',
									file: new File([required(event.output ?? undefined)], context.file.name, {
										type: context.file.type
									})
								}
							}
						}
					}
					return { target: 'cleanup', context: { result: failed(context, 'encode') } }
				},
				onError: (args) => {
					const { context } = args
					return { target: 'cleanup', context: { result: failed(context, 'encode') } }
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
							const { context } = args
							return {
								target: 'canvas',
								context: { bitmap: undefined, result: failed(context, 'cleanup') }
							}
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
							const { context } = args
							return {
								target: 'done',
								context: { canvas: undefined, result: failed(context, 'cleanup') }
							}
						}
					}
				},
				done: { type: 'final' }
			}
		},
		settling: {
			entry: () => {
				return {
					context: { source: undefined, preview: undefined, rendered: undefined, drag: undefined }
				}
			},
			always: (args) => {
				const { context } = args
				if (context.result?.kind === 'applied') {
					return { target: 'applied' }
				}
				if (context.result?.kind === 'cancelled') {
					return { target: 'cancelled' }
				}
				if (context.result?.kind === 'closed') {
					return { target: 'closed' }
				}
				return { target: 'failed' }
			}
		},
		applied: { type: 'final' },
		cancelled: { type: 'final' },
		closed: { type: 'final' },
		failed: { type: 'final' }
	}
})

export type ImageEditorPresentation = {
	status:
		| 'loading'
		| 'editing'
		| 'preview'
		| 'rendering'
		| 'exporting'
		| 'closing'
		| 'failed'
		| 'finished'
	viewport:
		| { kind: 'empty' }
		| {
				kind: 'selection'
				pixels: ImageData
				selection: ImageSelection
				adjustments: ImageAdjustments
				enabled: boolean
		  }
		| { kind: 'preview'; pixels: ImageData }
	mode: ImageSelectionMode
	adjustments: ImageAdjustments
	busy: boolean
	controls: {
		adjust: boolean
		apply: boolean
		preview: boolean
		edit: boolean
		reset: boolean
		cancel: boolean
	}
}

/** The editor owns capabilities; presentation renders them without inspecting actor states. */
export function imageEditorPresentation(
	snapshot: SnapshotFrom<typeof imageEditorMachine>
): ImageEditorPresentation {
	const { source, selection, preview, mode, adjustments } = snapshot.context
	const editing = snapshot.matches({ interactive: 'editing' })
	const previewing = snapshot.matches({ interactive: 'previewReady' })
	const status: ImageEditorPresentation['status'] =
		snapshot.status === 'error' || snapshot.matches('failed')
			? 'failed'
			: snapshot.status === 'done'
				? 'finished'
				: editing
					? 'editing'
					: previewing
						? 'preview'
						: snapshot.matches({ interactive: 'renderingPreview' }) ||
							  snapshot.matches('renderingApply')
							? 'rendering'
							: snapshot.matches('creatingCanvas') ||
								  snapshot.matches('painting') ||
								  snapshot.matches('encoding')
								? 'exporting'
								: snapshot.matches('cleanup') || snapshot.matches('settling')
									? 'closing'
									: 'loading'
	const viewport: ImageEditorPresentation['viewport'] =
		previewing && preview
			? { kind: 'preview', pixels: preview }
			: source && selection && ['editing', 'rendering', 'exporting'].includes(status)
				? { kind: 'selection', pixels: source, selection, adjustments, enabled: editing }
				: { kind: 'empty' }
	return {
		status,
		viewport,
		mode,
		adjustments,
		busy:
			status === 'loading' ||
			status === 'rendering' ||
			status === 'exporting' ||
			status === 'closing',
		controls: {
			adjust: editing || previewing,
			apply: editing || previewing,
			preview: editing,
			edit: previewing,
			reset: editing || previewing,
			cancel: snapshot.status === 'active' || status === 'failed'
		}
	}
}
