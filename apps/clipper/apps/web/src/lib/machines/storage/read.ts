import { setup, types } from 'xstate'
import { createLocalReadMachine } from './local-read.js'
import { documentSchema } from '../../capture/document-schema.js'
import type { Document } from '../../capture/document-schema.js'
import type {
	ReadInput,
	ReadResult,
	ReadOutcome,
	ReadCapabilities
} from '../../contracts/storage.js'

function required(value: ReadCapabilities | undefined) {
	if (!value) throw new Error('Reader unavailable')
	return value
}
type Context = Omit<ReadInput, 'capability' | 'reportTo'> & {
	capability: ReadCapabilities | undefined
	reportTo: ReadInput['reportTo']
} & { result: ReadResult | undefined; outcome: ReadOutcome }
function resultFor(document: Document | null, id: string): ReadResult {
	if (!document) return { kind: 'missing' }
	const parsed = documentSchema.safeParse(document)
	if (!parsed.success || parsed.data.id !== id) return { kind: 'corrupt' }
	const attachment = parsed.data.attachment
	if (!attachment) return { kind: 'unavailable' }
	return {
		kind: 'available',
		document: parsed.data,
		attachment,
		text: attachment.text,
		source: attachment.source,
		asset: {
			kind: 'available',
			bytes: new TextEncoder().encode(attachment.html || attachment.text),
			mediaType: attachment.html ? 'text/html' : 'text/plain'
		}
	}
}
const localRead = createLocalReadMachine<Document>()
/** One native joined read owns the Document and its attachment; no ID-based content traversal. */
export const readRecordMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<ReadInput>(),
		events: { SHUTDOWN: types<{}>() },
		output: types<ReadOutcome>(),
		emitted: { record: types<{ result: ReadResult }>() },
		children: { document: types<import('xstate').ActorRefFrom<typeof localRead>>() }
	},
	actors: { document: localRead }
}).createMachine({
	id: 'read-record',
	initial: 'reading',
	context: ({ input }) => ({
		...input,
		reportTo: input.reportTo,
		result: undefined,
		outcome: { kind: 'unavailable' }
	}),
	output: ({ context }) => context.outcome,
	on: { SHUTDOWN: { target: '.finished', context: { result: { kind: 'unavailable' } } } },
	states: {
		reading: {
			invoke: {
				id: 'document',
				src: 'document',
				input: ({ context }) => ({
					isCurrent: required(context.capability).isCurrent,
					observeConnection: required(context.capability).observeConnection,
					read: (signal: AbortSignal) => required(context.capability).document(context.id, signal)
				}),
				onDone: ({ context, event }) => ({
					target: 'finished',
					context: {
						result: required(context.capability).isCurrent()
							? resultFor(event.output.row, context.id)
							: { kind: 'unavailable' }
					}
				}),
				onError: { target: 'finished', context: { result: { kind: 'unavailable' } } }
			}
		},
		finished: {
			type: 'final',
			entry: ({ context }, enq) => {
				const result = context.result ?? { kind: 'unavailable' }
				enq.emit({ type: 'record', result })
				if (context.reportTo)
					enq.sendTo(context.reportTo, {
						type: 'READ_RESULT',
						generation: context.generation ?? 0,
						result
					})
				return {
					context: {
						id: '',
						capability: undefined,
						reportTo: undefined,
						result: undefined,
						outcome: { kind: result.kind }
					}
				}
			}
		}
	}
})
