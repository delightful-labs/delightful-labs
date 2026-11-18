import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { createAsyncLogic, setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { app } from '../../backend/jazz/schema.js'
import {
	anchorRowSchema,
	highlightRowSchema,
	nativeRangeSchema,
	READER_TEXT_VERSION,
	SOURCE_TEXT_VERSION,
	textFingerprint
} from '../../annotations/schema.js'
import type { AnnotationHighlight } from '../../annotations/schema.js'
import { toMarginHighlight } from '../../annotations/margin.js'
import type { PublicationPreview } from '../../annotations/publication-preview.js'
import { publicationPreviewSchema } from '../../annotations/publication-preview.js'
import { publicationFromRow } from '../../annotations/publication.js'
import { createGatewayMachine } from '../../machines/capture/gateway.js'
import { createParserWorkerMachine } from '../../machines/capture/parser-worker.js'
import { resolveDestination } from '../capture/destination.js'
import { fetchHop } from '../capture/transport.js'
import { extractInWorker, workerOpen } from '../capture/parser.js'
import type { PreviewInput } from './preview.js'

export const highlightSourceGateway = createGatewayMachine({
	resolve: resolveDestination,
	fetch: fetchHop,
	extract: extractInWorker
})
const sourceParser = createParserWorkerMachine<string>()
type Facts = { highlight: AnnotationHighlight; owned: boolean; active: boolean; addressed: boolean }
type Context = PreviewInput & { facts: Facts | undefined; preview: PublicationPreview | undefined }

/** The original source representation stays request-local. Only its verified
 * quote projection enters the existing publication model. The saved reader is
 * never relabeled as an original-page representation. */
export function createHighlightPreview(
	db: Pick<Db, 'one' | 'textAnchors'>,
	gateway = highlightSourceGateway
) {
	const actors = {
		read: createAsyncLogic({
			run: async ({
				input
			}: {
				input: { highlightId: string; binding: PreviewInput['binding']; republish: boolean }
			}): Promise<Facts | undefined> => {
				const scope = input.binding
				const row = await db.one(
					app.highlights.where({ id: input.highlightId, libraryId: scope.libraryId }).include({
						anchors: true,
						notes: true,
						document: true,
						library: app.libraries
							.where({ id: scope.libraryId, ownerId: scope.accountId })
							.include({
								publications: app.publications.where({
									highlightId: input.highlightId,
									noteId: null
								})
							})
					}),
					{ tier: ReadTier.Remote }
				)
				if (!row) return undefined
				return {
					highlight: highlightRowSchema.parse(row),
					owned: row.library?.ownerId === scope.accountId,
					active: row.document?.libraryId === scope.libraryId && row.document.status !== 'trashed',
					addressed: (row.library?.publications ?? [])
						.map(publicationFromRow)
						.some(
							(value) =>
								value.publishingDid === scope.publishingDid &&
								'uri' in value &&
								!(input.republish && value.state === 'unpublished')
						)
				}
			}
		}),
		gateway,
		parser: sourceParser,
		project: createAsyncLogic({
			run: async ({
				input,
				signal
			}: {
				input: {
					highlight: AnnotationHighlight
					text: string
					createdAt: Date
					binding: PreviewInput['binding']
				}
				signal: AbortSignal
			}) => {
				const reader = input.highlight.anchors.filter(
					(anchor) =>
						anchor.kind === 'reader' && anchor.normalizationVersion === READER_TEXT_VERSION
				)
				const anchor = reader[0]
				if (reader.length !== 1 || !anchor) throw new Error('Highlight source unavailable')
				const quote = anchor.range.matched
				const start = input.text.indexOf(quote)
				if (!quote || start < 0 || input.text.indexOf(quote, start + 1) >= 0)
					throw new Error('Highlight source unavailable')
				signal.throwIfAborted()
				const sourceAnchor = anchorRowSchema.parse({
					...anchor,
					kind: 'source',
					normalizationVersion: SOURCE_TEXT_VERSION,
					textHash: await textFingerprint(input.text),
					range: nativeRangeSchema.parse(
						db.textAnchors().captureRange(input.text, start, start + quote.length)
					)
				})
				const record = await toMarginHighlight(
					{
						...input.highlight,
						anchors: [
							...input.highlight.anchors.filter((value) => value.id !== anchor.id),
							sourceAnchor
						]
					},
					sourceAnchor.id,
					input.text,
					input.createdAt
				)
				signal.throwIfAborted()
				return publicationPreviewSchema.parse({
					libraryId: input.binding.libraryId,
					source: { highlightId: input.highlight.id },
					publishingDid: input.binding.publishingDid,
					record
				})
			}
		})
	}
	return setup({
		schemas: {
			input: types<PreviewInput>(),
			context: types<Context>(),
			output: types<PublicationPreview | undefined>(),
			events: { CANCEL: types() },
			children: {
				read: types<ActorRefFrom<typeof actors.read>>(),
				gateway: types<ActorRefFrom<typeof actors.gateway>>(),
				parser: types<ActorRefFrom<typeof actors.parser>>(),
				project: types<ActorRefFrom<typeof actors.project>>()
			}
		},
		actors,
		states: {
			admitting: {},
			reading: { schemas: { input: types<{ highlightId: string }>() } },
			fetching: { schemas: { context: types<{ facts: Facts }>() } },
			parsing: {
				schemas: {
					context: types<{ facts: Facts }>(),
					input: types<{ body: Uint8Array; mediaType: string; url: string }>()
				}
			},
			projecting: {
				schemas: { context: types<{ facts: Facts }>(), input: types<{ text: string }>() }
			},
			ready: {},
			unavailable: {}
		}
	}).createMachine({
		id: 'highlight-preview',
		initial: 'admitting',
		context: ({ input }) => ({ ...input, facts: undefined, preview: undefined }),
		output: ({ context }) => context.preview,
		on: { CANCEL: { target: '.unavailable' } },
		states: {
			admitting: {
				type: 'choice',
				choice: ({ context }) =>
					context.binding.isCurrent() &&
					'highlightId' in context.source &&
					Number.isFinite(context.createdAt.getTime())
						? { target: 'reading', input: { highlightId: context.source.highlightId } }
						: { target: 'unavailable' }
			},
			reading: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ input, context }) => ({
						...input,
						binding: context.binding,
						republish: context.republish ?? false
					}),
					onDone: ({ context, event }) => {
						const facts = event.output
						return facts &&
							facts.owned &&
							facts.active &&
							!facts.addressed &&
							facts.highlight.notes.length <= 1 &&
							context.binding.isCurrent()
							? { target: 'fetching', context: { facts } }
							: { target: 'unavailable' }
					},
					onError: { target: 'unavailable' }
				}
			},
			fetching: {
				invoke: {
					id: 'gateway',
					src: 'gateway',
					input: ({ context }) => ({ url: context.facts.highlight.source, mode: 'source' }),
					timeout: 30_000,
					onTimeout: { target: 'unavailable' },
					onError: { target: 'unavailable' },
					onDone: ({ event }) =>
						event.output.kind === 'success' && event.output.source
							? { target: 'parsing', input: { ...event.output.source, url: event.output.finalUrl } }
							: { target: 'unavailable' }
				}
			},
			parsing: {
				invoke: {
					id: 'parser',
					src: 'parser',
					input: ({ input }) => ({
						open: workerOpen<string>(input.body, input.mediaType, input.url, 'source')
					}),
					onDone: ({ event }) =>
						event.output.kind === 'success'
							? { target: 'projecting', input: { text: event.output.value } }
							: { target: 'unavailable' },
					onError: { target: 'unavailable' }
				}
			},
			projecting: {
				invoke: {
					id: 'project',
					src: 'project',
					input: ({ input, context }) => ({
						highlight: context.facts.highlight,
						text: input.text,
						createdAt: context.createdAt,
						binding: context.binding
					}),
					onDone: ({ context, event }) =>
						context.binding.isCurrent()
							? { target: 'ready', context: { preview: event.output } }
							: { target: 'unavailable' },
					onError: { target: 'unavailable' }
				}
			},
			ready: { type: 'final' },
			unavailable: { type: 'final' }
		}
	})
}
