import { createAsyncLogic, setup, types } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import { publicationPreviewSchema } from './publication-preview.js'
import type { PublicationPreview } from './publication-preview.js'
import type { AnnotationNote } from './schema.js'
import { t } from '../localization/index.js'
import { stateFeedback } from '../contracts/feedback.js'
import type { WorkflowMessage } from '../contracts/feedback.js'

type Capability = { libraryId: string; isCurrent: () => boolean }
type Context = {
	capability: Capability | undefined
	note: AnnotationNote | undefined
	requestId: number
	value: PublicationPreview | undefined
}
const request = createAsyncLogic({
	run: async ({
		input,
		signal
	}: {
		input: { libraryId: string; noteId: string }
		signal: AbortSignal
	}) => {
		const response = await fetch('/api/publication/preview', {
			method: 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ libraryId: input.libraryId, source: { noteId: input.noteId } })
		})
		if (!response.ok) {
			void response.body?.cancel().catch(() => {})
			throw new Error('Sharing preview unavailable')
		}
		const value: unknown = await response.json()
		signal.throwIfAborted()
		return publicationPreviewSchema.parse(value)
	}
})
export const sharingPreviewMachine = setup({
	schemas: {
		input: types<{ capability: Capability | undefined }>(),
		context: types<Context>(),
		events: {
			SHOW: types<{ note: AnnotationNote }>(),
			DISMISS: types<{ requestId?: number }>(),
			OBSERVED: types<{ notes: AnnotationNote[] }>(),
			SHUTDOWN: types(),
			INVALIDATED: types<{ noteId: string }>()
		},
		meta: types<{ name?: string; variant?: WorkflowMessage['variant'] }>(),
		children: { request: types<import('xstate').ActorRefFrom<typeof request>>() }
	},
	actors: { request },
	states: {
		closed: {},
		loading: { schemas: { context: types<{ capability: Capability; note: AnnotationNote }>() } },
		ready: { schemas: { context: types<{ value: PublicationPreview }>() } },
		unavailable: {},
		stopped: {}
	},
	guards: {
		matching: ({ context }: { context: Context }, value: PublicationPreview) =>
			!!context.capability?.isCurrent() &&
			value.libraryId === context.capability.libraryId &&
			'noteId' in value.source &&
			value.source.noteId === context.note?.id &&
			value.record.motivation === 'commenting' &&
			value.record.target.selector === undefined &&
			value.record.target.source === context.note.source &&
			value.record.body.value === context.note.text
	}
}).createMachine({
	id: 'sharing-preview',
	initial: 'closed',
	context: ({ input }) => ({
		capability: input.capability,
		note: undefined,
		requestId: 0,
		value: undefined
	}),
	on: {
		SHOW: ({ context, event }) =>
			context.capability?.isCurrent() &&
			event.note.libraryId === context.capability.libraryId &&
			event.note.highlightId === null &&
			event.note.documentId !== null
				? {
						target: '.loading',
						reenter: true,
						context: {
							note: { ...event.note },
							value: undefined,
							requestId: context.requestId + 1,
							capability: context.capability
						}
					}
				: undefined,
		DISMISS: ({ context, event }) =>
			event.requestId === undefined || event.requestId === context.requestId
				? { target: '.closed', context: { note: undefined, value: undefined } }
				: undefined,
		INVALIDATED: ({ context, event }) =>
			event.noteId === context.note?.id
				? { target: '.closed', context: { note: undefined, value: undefined } }
				: undefined,
		OBSERVED: ({ context, event }) => {
			if (!context.note) return
			const note = event.notes.find((note) => note.id === context.note?.id)
			return !note ||
				note.text !== context.note.text ||
				note.source !== context.note.source ||
				note.documentId !== context.note.documentId ||
				note.highlightId !== null ||
				note.libraryId !== context.note.libraryId
				? { target: '.closed', context: { note: undefined, value: undefined } }
				: undefined
		},
		SHUTDOWN: {
			target: '.stopped',
			context: { note: undefined, value: undefined, capability: undefined }
		}
	},
	states: {
		closed: {},
		loading: {
			meta: { name: t('status.preparing'), variant: 'info' },
			invoke: {
				id: 'request',
				src: 'request',
				input: ({ context }) => ({
					libraryId: context.capability.libraryId,
					noteId: context.note.id
				}),
				timeout: 50_000,
				onTimeout: { target: 'unavailable' },
				onError: { target: 'unavailable' },
				onDone: (args) =>
					args.guards.matching(args, args.event.output)
						? { target: 'ready', context: { value: args.event.output } }
						: { target: 'unavailable' }
			}
		},
		ready: {},
		unavailable: { meta: { name: t('publication.unavailable'), variant: 'error' } },
		stopped: { type: 'final' }
	}
})
export function selectSharingPreview(
	snapshot: SnapshotFrom<typeof sharingPreviewMachine> | undefined
) {
	const open =
		!!snapshot &&
		snapshot.status === 'active' &&
		!snapshot.matches('closed') &&
		!!snapshot.context.capability?.isCurrent()
	return {
		open,
		requestId: snapshot?.context.requestId ?? 0,
		noteId: open ? snapshot?.context.note?.id : undefined,
		value: open && snapshot?.matches('ready') ? snapshot.context.value : undefined,
		pending: open && snapshot?.matches('loading') === true,
		retry: open && snapshot?.matches('unavailable') === true,
		message: open && snapshot ? stateFeedback(Object.values(snapshot.getMeta())) : undefined
	}
}
