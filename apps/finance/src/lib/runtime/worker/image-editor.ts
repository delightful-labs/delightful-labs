import { createCallbackLogic, setup, types } from 'xstate'
import { financeImageEditorResult } from '../../contracts/worker-images.js'
import type { ImageEditorInput, ImageEditorOutput } from '../../machines/images/image-editor.js'
const dialog = createCallbackLogic<{ type: 'CANCEL' | 'SHUTDOWN' }, ImageEditorInput>(
	({ input, receive, sendBack }) => {
		const channel = new MessageChannel()
		channel.port1.onmessage = (event: MessageEvent<unknown>) => {
			const result = financeImageEditorResult.safeParse(event.data)
			sendBack({
				type: 'RESULT',
				result: result.success ? result.data : { kind: 'failed', reason: 'input' }
			})
		}
		channel.port1.onmessageerror = () =>
			sendBack({ type: 'RESULT', result: { kind: 'failed', reason: 'input' } })
		receive((event) => channel.port1.postMessage(event))
		globalThis.postMessage({ type: 'EDIT_IMAGE', file: input.file }, { transfer: [channel.port2] })
		return () => {
			channel.port1.postMessage({ type: 'SHUTDOWN' })
			channel.port1.close()
		}
	}
)
/** The database workflow retains ownership while Window supplies only the native editor UI. */
export const windowImageEditorMachine = setup({
	schemas: {
		input: types<ImageEditorInput>(),
		context: types<{ input: ImageEditorInput; result: ImageEditorOutput | undefined }>(),
		output: types<ImageEditorOutput>(),
		events: { RESULT: types<{ result: ImageEditorOutput }>(), CANCEL: types(), SHUTDOWN: types() },
		children: { dialog: types<import('xstate').ActorRefFrom<typeof dialog>>() }
	},
	actors: { dialog }
}).createMachine({
	id: 'finance-window-image-editor',
	context: ({ input }) => ({ input, result: undefined }),
	initial: 'editing',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing image editor result')
		return context.result
	},
	states: {
		editing: {
			invoke: {
				id: 'dialog',
				src: 'dialog',
				input: ({ context }) => context.input,
				onError: { target: 'done', context: { result: { kind: 'failed', reason: 'input' } } }
			},
			on: {
				RESULT: ({ event }) => ({ target: 'done', context: { result: event.result } }),
				CANCEL: (_, enq) => enq.sendTo('dialog', { type: 'CANCEL' }),
				SHUTDOWN: (_, enq) => enq.sendTo('dialog', { type: 'SHUTDOWN' })
			}
		},
		done: { type: 'final' }
	}
})
