import type { Db } from 'jazz-tools'
import { setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { createDocumentNotePreview } from './preview.js'
import type { PreviewInput } from './preview.js'
import { createHighlightPreview, highlightSourceGateway } from './highlight-preview.js'
import type { PublicationPreview } from '../../annotations/publication-preview.js'

export function createPublicationPreview(
	db: Pick<Db, 'one' | 'textAnchors'>,
	gateway = highlightSourceGateway
) {
	const actors = {
		note: createDocumentNotePreview(db),
		highlight: createHighlightPreview(db, gateway)
	}
	return setup({
		schemas: {
			input: types<PreviewInput>(),
			context: types<{ input: PreviewInput; value: PublicationPreview | undefined }>(),
			output: types<PublicationPreview | undefined>(),
			children: {
				note: types<ActorRefFrom<typeof actors.note>>(),
				highlight: types<ActorRefFrom<typeof actors.highlight>>()
			}
		},
		actors,
		states: { choosing: {}, note: {}, highlight: {}, done: {} }
	}).createMachine({
		id: 'publication-preview',
		initial: 'choosing',
		context: ({ input }) => ({ input, value: undefined }),
		output: ({ context }) => context.value,
		states: {
			choosing: {
				type: 'choice',
				choice: ({ context }) =>
					'highlightId' in context.input.source ? { target: 'highlight' } : { target: 'note' }
			},
			note: {
				invoke: {
					id: 'note',
					src: 'note',
					input: ({ context }) => context.input,
					onDone: ({ event }) => ({ target: 'done', context: { value: event.output } }),
					onError: { target: 'done' }
				}
			},
			highlight: {
				invoke: {
					id: 'highlight',
					src: 'highlight',
					input: ({ context }) => context.input,
					onDone: ({ event }) => ({ target: 'done', context: { value: event.output } }),
					onError: { target: 'done' }
				}
			},
			done: { type: 'final' }
		}
	})
}
