import { z } from 'zod'
import { publicationBaseSchema, publicationSchema } from './publication.js'
import type { Publication } from './publication.js'
import { createAsyncLogic, setup, types } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import { publicationPreviewSchema } from './publication-preview.js'
import type { PublicationPreview } from './publication-preview.js'
import type { AnnotationNote } from './schema.js'
import { t } from '../localization/index.js'
import { stateFeedback } from '../contracts/feedback.js'
import type { WorkflowMessage } from '../contracts/feedback.js'

type Preview = PublicationPreview | Publication
type Capability = { libraryId: string; isCurrent: () => boolean }
type Context = {
	capability: Capability | undefined
	note: AnnotationNote | undefined
	requestId: number
	value: Preview | undefined
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
		return z.union([publicationPreviewSchema, publicationSchema]).parse(value)
	}
})
const publish = createAsyncLogic({
	run: async ({ input, signal }: { input: Preview; signal: AbortSignal }) => {
		const response = await fetch('/api/publication/publish', {
			method: 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(
				publicationBaseSchema.parse({
					libraryId: input.libraryId,
					source: input.source,
					publishingDid: input.publishingDid
				})
			)
		})
		if (!response.ok) {
			void response.body?.cancel().catch(() => {})
			return { status: response.status, publication: undefined }
		}
		const value: unknown = await response.json()
		signal.throwIfAborted()
		return { status: response.status, publication: publicationSchema.parse(value) }
	}
})
export const sharingPreviewMachine = setup({
	schemas: {
		input: types<{ capability: Capability | undefined }>(),
		context: types<Context>(),
		events: {
			PUBLISH: types<{ requestId: number }>(),
			SHOW: types<{ note: AnnotationNote }>(),
			DISMISS: types<{ requestId?: number }>(),
			OBSERVED: types<{ notes: AnnotationNote[] }>(),
			SHUTDOWN: types(),
			INVALIDATED: types<{ noteId: string }>()
		},
		meta: types<{ name?: string; variant?: WorkflowMessage['variant'] }>(),
		children: {
			request: types<import('xstate').ActorRefFrom<typeof request>>(),
			publish: types<import('xstate').ActorRefFrom<typeof publish>>()
		}
	},
	actors: { request, publish },
	states: {
		closed: {},
		loading: { schemas: { context: types<{ capability: Capability; note: AnnotationNote }>() } },
		ready: { schemas: { context: types<{ value: Preview }>() } },
		publishing: { schemas: { context: types<{ value: Preview }>() } },
		published: {
			schemas: {
				context: types<{
					value: Preview
					publication: Extract<Publication, { state: 'published' }>
				}>()
			}
		},
		authorize: { schemas: { context: types<{ value: Preview }>() } },
		publishFailed: { schemas: { context: types<{ value: Preview }>() } },
		unavailable: {},
		stopped: {}
	},
	guards: {
		matching: ({ context }: { context: Context }, value: Preview) =>
			!!context.capability?.isCurrent() &&
			value.libraryId === context.capability.libraryId &&
			'noteId' in value.source &&
			value.source.noteId === context.note?.id &&
			('state' in value ||
				(value.record.motivation === 'commenting' &&
					value.record.target.selector === undefined &&
					value.record.target.source === context.note.source &&
					value.record.body.value === context.note.text))
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
				onDone: (args) => {
					const value = args.event.output
					if (!args.guards.matching(args, value)) return { target: 'unavailable' }
					return 'state' in value && value.state === 'published'
						? { target: 'published', context: { value, publication: value } }
						: { target: 'ready', context: { value } }
				}
			}
		},
		ready: {
			on: {
				PUBLISH: ({ context, event }) =>
					context.capability?.isCurrent() && event.requestId === context.requestId
						? { target: 'publishing' }
						: undefined
			}
		},
		publishing: {
			meta: { name: t('status.preparing'), variant: 'info' },
			invoke: {
				id: 'publish',
				src: 'publish',
				input: ({ context }) => context.value,
				timeout: 125_000,
				onTimeout: { target: 'publishFailed' },
				onError: { target: 'publishFailed' },
				onDone: ({ context, event }) => {
					const value = event.output.publication
					if (event.output.status === 403) return { target: 'authorize' }
					if (
						!value ||
						value.state !== 'published' ||
						!context.capability?.isCurrent() ||
						value.libraryId !== context.value.libraryId ||
						value.publishingDid !== context.value.publishingDid ||
						!('noteId' in value.source) ||
						!('noteId' in context.value.source) ||
						value.source.noteId !== context.value.source.noteId
					)
						return { target: 'publishFailed' }
					return { target: 'published', context: { publication: value } }
				}
			}
		},
		published: { meta: { name: t('publication.published'), variant: 'info' } },
		authorize: {},
		publishFailed: {
			meta: { name: t('publication.failed'), variant: 'error' },
			on: {
				PUBLISH: ({ context, event }) =>
					context.capability?.isCurrent() && event.requestId === context.requestId
						? { target: 'publishing' }
						: undefined
			}
		},
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
		value: open ? snapshot?.context.value : undefined,
		canPublish:
			open && (snapshot?.matches('ready') === true || snapshot?.matches('publishFailed') === true),
		authorize: open && snapshot?.matches('authorize') === true,
		publication: open && snapshot?.matches('published') ? snapshot.context.publication : undefined,
		pending:
			open && (snapshot?.matches('loading') === true || snapshot?.matches('publishing') === true),
		retry: open && snapshot?.matches('unavailable') === true,
		message: open && snapshot ? stateFeedback(Object.values(snapshot.getMeta())) : undefined
	}
}
