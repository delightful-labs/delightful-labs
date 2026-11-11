import { imageEditorMachine } from '../../images/image-editor.js'
import {
	MAX_TRANSACTION_ATTACHMENT_BYTES,
	isTransactionAttachmentType
} from '#lib/domain/transaction-attachments.js'
import { setup, types, matchesState } from 'xstate'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../../contracts/event-payload.js'

type Input = { editable: boolean }
type Event =
	| { type: 'SELECT'; files: File[] }
	| { type: 'EDIT'; file: File }
	| { type: 'SET_EDITABLE'; editable: boolean }
	| { type: 'CLOSE' | 'SHUTDOWN' }
type Context = {
	files: File[]
	target: File | undefined
	editable: boolean
	error: 'invalidSelection' | 'editingFailed' | null
}
function editableImage(file: File): boolean {
	return (
		isTransactionAttachmentType(file.type) &&
		file.size > 0 &&
		file.size <= MAX_TRANSACTION_ATTACHMENT_BYTES
	)
}
function requiredFile(file: File | undefined): File {
	if (!file) throw new Error('Missing transaction image selection')
	return file
}
const events0 = {
	SELECT: types<EventPayload<Event, 'SELECT'>>(),
	EDIT: types<EventPayload<Event, 'EDIT'>>(),
	SET_EDITABLE: types<EventPayload<Event, 'SET_EDITABLE'>>(),
	CLOSE: types<EventPayload<Event, 'CLOSE'>>(),
	SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof imageEditorMachine>>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Draft selection owns one invoked editor, retained while cancellation drains its resources. */
export const transactionImageSelectionMachine = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<{ kind: 'closed' }>(),
		children: {
			editor:
				types<import('xstate').ActorRefFrom<{ editor: typeof imageEditorMachine }['editor']>>()
		}
	},
	actors: { editor: imageEditorMachine },
	guards: {},
	actions: {}
}).createMachine({
	id: 'transaction-image-selection',
	initial: 'checkingReadiness',
	context: ({ input }) => ({ files: [], target: undefined, editable: input.editable, error: null }),
	output: () => ({ kind: 'closed' }),
	on: {
		SET_EDITABLE: (args) => {
			return { target: '.checkingReadiness', context: { editable: args.event.editable } }
		},
		SHUTDOWN: { target: '.closed' }
	},
	states: {
		checkingReadiness: {
			entry: () => {
				return { context: { target: undefined } }
			},
			always: (args) => {
				if (args.context.editable) {
					return { target: 'ready' }
				}
				return { target: 'locked' }
			}
		},
		ready: {
			on: {
				SELECT: (args) => {
					return { context: { files: [...args.event.files], error: null } }
				},
				EDIT: (args) => {
					const { event } = args
					if (args.context.files.includes(event.file) && editableImage(event.file)) {
						return { target: 'editing', context: { target: event.file, error: null } }
					}
					return { context: { error: 'invalidSelection' } }
				}
			}
		},
		locked: {},
		editing: {
			initial: 'open',
			invoke: {
				id: 'editor',
				src: 'editor',
				input: ({ context }) => ({ file: requiredFile(context.target), mode: 'perspective' }),
				onDone: (args) => {
					const { context, event } = args
					if (matchesState({ editing: 'shuttingDown' }, args.value)) {
						return { target: 'closed' }
					}
					if (
						matchesState({ editing: 'open' }, args.value) &&
						context.editable &&
						context.target !== undefined &&
						context.files.includes(context.target) &&
						event.output.kind === 'applied' &&
						editableImage(event.output.file)
					) {
						return {
							target: 'checkingReadiness',
							context: {
								files: (({ context, event }) => {
									const output = event.output
									return output.kind === 'applied'
										? context.files.map((file) => (file === context.target ? output.file : file))
										: context.files
								})(args)
							}
						}
					}
					if (matchesState({ editing: 'open' }, args.value) && event.output.kind === 'failed') {
						return { target: 'checkingReadiness', context: { error: 'editingFailed' } }
					}
					if (
						matchesState({ editing: 'open' }, args.value) &&
						event.output.kind === 'applied' &&
						!editableImage(event.output.file)
					) {
						return { target: 'checkingReadiness', context: { error: 'invalidSelection' } }
					}
					return { target: 'checkingReadiness' }
				},
				onError: (args) => {
					if (matchesState({ editing: 'shuttingDown' }, args.value)) {
						return { target: 'closed' }
					}
					return { target: 'checkingReadiness', context: { error: 'editingFailed' } }
				}
			},
			on: {
				CLOSE: (args, enq) => {
					{
						const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
						const child = args.children.editor
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
					}
					return { target: '.cancelling' }
				},
				SELECT: (args, enq) => {
					if (!args.context.editable) return
					{
						const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
						const child = args.children.editor
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
					}
					return {
						target: '.cancelling',
						context: ((args) => ({ files: (({ event }) => [...event.files])(args), error: null }))(
							args
						)
					}
				},
				SET_EDITABLE: (args, enq) => {
					const { event } = args
					if (!event.editable) {
						{
							const command: 'CANCEL' | 'SHUTDOWN' = 'CANCEL'
							const child = args.children.editor
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
						}
						return {
							target: '.cancelling',
							context: ((args) => ({ editable: (({ event }) => event.editable)(args) }))(args)
						}
					}
					return {
						context: ((args) => ({ editable: (({ event }) => event.editable)(args) }))(args)
					}
				},
				SHUTDOWN: (args, enq) => {
					{
						const command: 'CANCEL' | 'SHUTDOWN' = 'SHUTDOWN'
						const child = args.children.editor
						if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: command })
					}
					return { target: '.shuttingDown' }
				}
			},
			states: {
				open: {},
				cancelling: {},
				shuttingDown: { on: { CLOSE: {}, SELECT: {}, SET_EDITABLE: {}, SHUTDOWN: {} } }
			}
		},
		closed: { type: 'final' }
	}
})

export function transactionImageSelectionPresentation(
	snapshot: SnapshotFrom<typeof transactionImageSelectionMachine>
): {
	files: File[]
	canSelect: boolean
	editableFiles: readonly File[]
	error: Context['error']
	editor: { file: File; actor: ActorRefFrom<typeof imageEditorMachine> } | null
} {
	const child = snapshot.children.editor
	const file = snapshot.context.target
	const ready = snapshot.matches('ready')
	return {
		files: snapshot.context.files,
		canSelect: ready,
		editableFiles: ready ? snapshot.context.files.filter(editableImage) : [],
		error: snapshot.context.error,
		editor: snapshot.matches({ editing: 'open' }) && child && file ? { file, actor: child } : null
	}
}
