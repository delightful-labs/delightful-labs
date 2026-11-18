import { z } from 'zod'
import { publicationBaseSchema, publicationSchema } from './publication.js'
import type { Publication } from './publication.js'
import { createAsyncLogic, setup, types } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import { publicationPreviewSchema } from './publication-preview.js'
import type { PublicationPreview } from './publication-preview.js'
import { highlightRowSchema, READER_TEXT_VERSION } from './schema.js'
import type { PublicationSource } from './publication-link.js'
import type { AnnotationNote, AnnotationHighlight } from './schema.js'
import { noun, t } from '../localization/index.js'
import { stateFeedback } from '../contracts/feedback.js'
import type { WorkflowMessage } from '../contracts/feedback.js'

type Annotation = AnnotationNote | AnnotationHighlight
function sourceOf(value: Annotation): PublicationSource {
	return 'anchors' in value ? { highlightId: value.id } : { noteId: value.id }
}
function sameSource(a: PublicationSource, b: PublicationSource) {
	return 'noteId' in a && 'noteId' in b
		? a.noteId === b.noteId
		: 'highlightId' in a && 'highlightId' in b && a.highlightId === b.highlightId
}
function quoteOf(value: AnnotationHighlight) {
	return value.anchors.find(
		(anchor) => anchor.kind === 'reader' && anchor.normalizationVersion === READER_TEXT_VERSION
	)?.range.matched
}
type Preview = PublicationPreview | Publication
type Capability = { libraryId: string; isCurrent: () => boolean }
type Context = {
	capability: Capability | undefined
	annotation: Annotation | undefined
	requestId: number
	value: Preview | undefined
}
const request = createAsyncLogic({
	run: async ({
		input,
		signal
	}: {
		input: { libraryId: string; source: PublicationSource }
		signal: AbortSignal
	}) => {
		const response = await fetch('/api/publication/preview', {
			method: 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ libraryId: input.libraryId, source: input.source })
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
const submission = (operation: 'publish' | 'unpublish') =>
	createAsyncLogic({
		run: async ({ input, signal }: { input: Preview; signal: AbortSignal }) => {
			const response = await fetch('/api/publication/' + operation, {
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
const publish = submission('publish')
const unpublish = submission('unpublish')
export const sharingPreviewMachine = setup({
	schemas: {
		input: types<{ capability: Capability | undefined }>(),
		context: types<Context>(),
		events: {
			PUBLISH: types<{ requestId: number }>(),
			UNPUBLISH: types<{ requestId: number }>(),
			SHOW: types<{ note: AnnotationNote }>(),
			SHOW_HIGHLIGHT: types<{ highlight: AnnotationHighlight }>(),
			INVALIDATED_HIGHLIGHT: types<{ highlightId: string }>(),
			DISMISS: types<{ requestId?: number }>(),
			OBSERVED: types<{ notes?: AnnotationNote[]; highlights?: AnnotationHighlight[] }>(),
			SHUTDOWN: types(),
			INVALIDATED: types<{ noteId: string }>()
		},
		meta: types<{ name?: string; variant?: WorkflowMessage['variant'] }>(),
		children: {
			request: types<import('xstate').ActorRefFrom<typeof request>>(),
			publish: types<import('xstate').ActorRefFrom<typeof publish>>(),
			unpublish: types<import('xstate').ActorRefFrom<typeof unpublish>>()
		}
	},
	actors: { request, publish, unpublish },
	states: {
		closed: {},
		loading: { schemas: { context: types<{ capability: Capability; annotation: Annotation }>() } },
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
		unpublishing: { schemas: { context: types<{ value: Preview }>() } },
		unpublished: { schemas: { context: types<{ value: Preview }>() } },
		unpublishFailed: { schemas: { context: types<{ value: Preview }>() } },
		unavailable: {},
		highlightUnavailable: {},
		stopped: {}
	},
	guards: {
		matching: ({ context }: { context: Context }, value: Preview) => {
			const annotation = context.annotation
			if (
				!annotation ||
				!context.capability?.isCurrent() ||
				value.libraryId !== context.capability.libraryId ||
				!sameSource(value.source, sourceOf(annotation))
			)
				return false
			if ('state' in value) return true
			if ('anchors' in annotation) {
				const note = annotation.notes[0]
				return (
					value.record.target.source === annotation.source &&
					value.record.target.selector?.exact === quoteOf(annotation) &&
					(note
						? value.record.motivation === 'commenting' && value.record.body.value === note.text
						: value.record.motivation === 'highlighting')
				)
			}
			return (
				value.record.motivation === 'commenting' &&
				value.record.target.selector === undefined &&
				value.record.target.source === annotation.source &&
				value.record.body.value === annotation.text
			)
		}
	}
}).createMachine({
	id: 'sharing-preview',
	initial: 'closed',
	context: ({ input }) => ({
		capability: input.capability,
		annotation: undefined,
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
							annotation: { ...event.note },
							value: undefined,
							requestId: context.requestId + 1,
							capability: context.capability
						}
					}
				: undefined,
		SHOW_HIGHLIGHT: ({ context, event }) => {
			const parsed = highlightRowSchema.safeParse(event.highlight)
			return context.capability?.isCurrent() &&
				parsed.success &&
				parsed.data.libraryId === context.capability.libraryId
				? {
						target: '.loading',
						reenter: true,
						context: {
							annotation: parsed.data,
							value: undefined,
							requestId: context.requestId + 1,
							capability: context.capability
						}
					}
				: undefined
		},
		INVALIDATED_HIGHLIGHT: ({ context, event }) =>
			context.annotation &&
			'anchors' in context.annotation &&
			context.annotation.id === event.highlightId
				? { target: '.closed', context: { annotation: undefined, value: undefined } }
				: undefined,
		DISMISS: ({ context, event }) =>
			event.requestId === undefined || event.requestId === context.requestId
				? { target: '.closed', context: { annotation: undefined, value: undefined } }
				: undefined,
		INVALIDATED: ({ context, event }) =>
			context.annotation &&
			(context.annotation.id === event.noteId ||
				('anchors' in context.annotation &&
					context.annotation.notes.some((note) => note.id === event.noteId)))
				? { target: '.closed', context: { annotation: undefined, value: undefined } }
				: undefined,
		OBSERVED: ({ context, event }) => {
			const current = context.annotation
			if (!current) return
			if ('anchors' in current) {
				if (!event.highlights) return
				const value = event.highlights.find((value) => value.id === current.id)
				return !value ||
					value.libraryId !== current.libraryId ||
					value.documentId !== current.documentId ||
					value.source !== current.source ||
					quoteOf(value) !== quoteOf(current) ||
					JSON.stringify(value.notes) !== JSON.stringify(current.notes)
					? { target: '.closed', context: { annotation: undefined, value: undefined } }
					: undefined
			}
			if (!event.notes) return
			const note = event.notes.find((note) => note.id === current.id)
			return !note ||
				note.text !== current.text ||
				note.source !== current.source ||
				note.documentId !== current.documentId ||
				note.highlightId !== null ||
				note.libraryId !== current.libraryId
				? { target: '.closed', context: { annotation: undefined, value: undefined } }
				: undefined
		},
		SHUTDOWN: {
			target: '.stopped',
			context: { annotation: undefined, value: undefined, capability: undefined }
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
					source: sourceOf(context.annotation)
				}),
				timeout: 50_000,
				onTimeout: ({ context }) =>
					'anchors' in context.annotation
						? { target: 'highlightUnavailable' }
						: { target: 'unavailable' },
				onError: ({ context }) =>
					'anchors' in context.annotation
						? { target: 'highlightUnavailable' }
						: { target: 'unavailable' },
				onDone: (args) => {
					const value = args.event.output
					if (!args.guards.matching(args, value))
						return 'anchors' in args.context.annotation
							? { target: 'highlightUnavailable' }
							: { target: 'unavailable' }
					if ('state' in value && value.state === 'unpublished')
						return { target: 'unpublished', context: { value } }
					if ('state' in value && value.state === 'unpublishing')
						return { target: 'unpublishFailed', context: { value } }
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
						!sameSource(value.source, context.value.source)
					)
						return { target: 'publishFailed' }
					return { target: 'published', context: { publication: value, value } }
				}
			}
		},
		published: {
			meta: { name: t('publication.published'), variant: 'info' },
			on: {
				UNPUBLISH: ({ context, event }) =>
					context.capability?.isCurrent() && event.requestId === context.requestId
						? { target: 'unpublishing' }
						: undefined
			}
		},
		unpublishing: {
			meta: { name: t('status.preparing'), variant: 'info' },
			invoke: {
				id: 'unpublish',
				src: 'unpublish',
				input: ({ context }) => context.value,
				timeout: 125_000,
				onTimeout: { target: 'unpublishFailed' },
				onError: { target: 'unpublishFailed' },
				onDone: ({ context, event }) => {
					if (event.output.status === 403) return { target: 'authorize' }
					const value = event.output.publication
					if (
						!value ||
						value.state !== 'unpublished' ||
						!context.capability?.isCurrent() ||
						value.libraryId !== context.value.libraryId ||
						value.publishingDid !== context.value.publishingDid ||
						!sameSource(value.source, context.value.source)
					)
						return { target: 'unpublishFailed' }
					return { target: 'unpublished', context: { value } }
				}
			}
		},
		unpublished: {
			meta: { name: t('publication.unpublished'), variant: 'info' },
			on: {
				PUBLISH: ({ context, event }) =>
					context.capability?.isCurrent() && event.requestId === context.requestId
						? { target: 'publishing' }
						: undefined
			}
		},
		unpublishFailed: {
			meta: { name: t('status.save_unknown'), variant: 'error' },
			on: {
				UNPUBLISH: ({ context, event }) =>
					context.capability?.isCurrent() && event.requestId === context.requestId
						? { target: 'unpublishing' }
						: undefined
			}
		},
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
		highlightUnavailable: {
			meta: {
				name: t('status.unavailable_subject', { subject: noun('highlight') }),
				variant: 'error'
			}
		},
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
	const message = open && snapshot ? stateFeedback(Object.values(snapshot.getMeta())) : undefined
	return {
		open,
		requestId: snapshot?.context.requestId ?? 0,
		source:
			open && snapshot?.context.annotation ? sourceOf(snapshot.context.annotation) : undefined,
		quote:
			open && snapshot?.context.annotation && 'anchors' in snapshot.context.annotation
				? quoteOf(snapshot.context.annotation)
				: undefined,
		value: open ? snapshot?.context.value : undefined,
		canPublish:
			open &&
			(snapshot?.matches('ready') === true ||
				snapshot?.matches('publishFailed') === true ||
				snapshot?.matches('unpublished') === true),
		canUnpublish:
			open &&
			(snapshot?.matches('published') === true || snapshot?.matches('unpublishFailed') === true),
		noteText:
			open && snapshot?.context.annotation
				? 'anchors' in snapshot.context.annotation
					? snapshot.context.annotation.notes[0]?.text
					: snapshot.context.annotation.text
				: undefined,
		authorize: open && snapshot?.matches('authorize') === true,
		publication: open && snapshot?.matches('published') ? snapshot.context.publication : undefined,
		pending:
			open &&
			(snapshot?.matches('loading') === true ||
				snapshot?.matches('publishing') === true ||
				snapshot?.matches('unpublishing') === true),
		retry:
			open &&
			(snapshot?.matches('unavailable') === true ||
				snapshot?.matches('highlightUnavailable') === true),
		message
	}
}
