import { z } from 'zod'
import { createAsyncLogic, setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { atRecordUriSchema, publicationDid } from '../../annotations/publication-link.js'
import { parsePdsRecord } from './pds-record.js'
import type { PdsReadResult, PdsRecord } from './pds-record.js'

/** The existing OAuth SDK's opaque, host-owned fetch capability. */
export type PdsReadSession = {
	readonly did: string
	handle: (pathname: string, init?: RequestInit) => Promise<Response>
}
type Input = { uri: string; session: PdsReadSession; isCurrent: () => boolean }
const deadlineMs = 30_000
const responseLimit = 1_048_576

function requestPath(uri: string) {
	const params = new URLSearchParams({
		repo: publicationDid(uri),
		collection: 'at.margin.note',
		rkey: uri.slice(uri.lastIndexOf('/') + 1)
	})
	return '/xrpc/com.atproto.repo.getRecord?' + params
}

/** One selected GET adapter owns the Response through bounded native decoding.
 * No raw body lease is transferred between actors; even a late SDK response is
 * released after stop. HTTP/domain interpretation belongs to the chart below. */
async function requestRecord(input: Input, signal: AbortSignal) {
	const startedAt = Date.now()
	signal.throwIfAborted()
	const response = await input.session.handle(requestPath(input.uri), {
		method: 'GET',
		headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
		cache: 'no-store',
		redirect: 'error',
		signal
	})
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
	const cancel = () => {
		if (reader) void reader.cancel().catch(() => {})
	}
	try {
		signal.throwIfAborted()
		if (
			response.redirected ||
			response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
				'application/json'
		)
			throw new Error('PDS response cannot be read')
		reader = response.body?.getReader()
		if (!reader) throw new Error('PDS response cannot be read')
		signal.addEventListener('abort', cancel, { once: true })
		signal.throwIfAborted()
		const chunks: Uint8Array[] = []
		let size = 0
		for (;;) {
			const chunk = await reader.read()
			if (chunk.done) break
			size += chunk.value.byteLength
			if (size > responseLimit) throw new Error('PDS response cannot be read')
			chunks.push(chunk.value)
		}
		signal.throwIfAborted()
		const bytes = new Uint8Array(size)
		let offset = 0
		for (const chunk of chunks) {
			bytes.set(chunk, offset)
			offset += chunk.length
		}
		const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
		return { status: response.status, value, elapsedMs: Date.now() - startedAt }
	} finally {
		signal.removeEventListener('abort', cancel)
		if (reader) {
			void reader.cancel().catch(() => {})
			reader.releaseLock()
		} else {
			void response.body?.cancel().catch(() => {})
		}
	}
}

function reportsNotFound(status: number, value: unknown) {
	return (
		(status === 400 || status === 404) &&
		typeof value === 'object' &&
		value !== null &&
		'error' in value &&
		z.literal('RecordNotFound').safeParse(value.error).success
	)
}

const actors = {
	read: createAsyncLogic({
		run: ({ input, signal }: { input: Input; signal: AbortSignal }) => requestRecord(input, signal)
	})
}

/** Invoked by a verified host for one immutable address/session binding. This
 * read-only child does not restore/revoke sessions, change intent or dispatch a
 * write. notFound reports the PDS observation, including possible takedowns. */
export const pdsRead = setup({
	schemas: {
		input: types<Input>(),
		context: types<Input>(),
		output: types<PdsReadResult>(),
		events: { CANCEL: types() },
		children: { read: types<ActorRefFrom<typeof actors.read>>() }
	},
	actors,
	guards: {
		current: ({ context }: { context: Input }) =>
			atRecordUriSchema.safeParse(context.uri).success &&
			context.uri.trim() === context.uri &&
			context.isCurrent() &&
			context.session.did === publicationDid(context.uri)
	},
	states: {
		admitting: {},
		reading: {},
		found: { schemas: { input: types<{ record: PdsRecord }>() } },
		notFound: {},
		failed: {},
		timedOut: {},
		cancelled: {}
	}
}).createMachine({
	id: 'pds-record-read',
	initial: 'admitting',
	context: ({ input }) => ({ ...input }),
	on: { CANCEL: { target: '.cancelled' } },
	states: {
		admitting: {
			type: 'choice',
			choice: (args) => (args.guards.current(args) ? { target: 'reading' } : { target: 'failed' })
		},
		reading: {
			invoke: {
				id: 'read',
				src: 'read',
				input: ({ context }) => context,
				timeout: deadlineMs,
				onTimeout: { target: 'timedOut' },
				onError: { target: 'failed' },
				onDone: (args) => {
					if (!args.guards.current(args)) return { target: 'failed' }
					const { status, value, elapsedMs } = args.event.output
					if (elapsedMs >= deadlineMs) return { target: 'timedOut' }
					if (status === 200) {
						try {
							return { target: 'found', input: { record: parsePdsRecord(value, args.context.uri) } }
						} catch {
							return { target: 'failed' }
						}
					}
					return reportsNotFound(status, value) ? { target: 'notFound' } : { target: 'failed' }
				}
			}
		},
		found: { type: 'final', output: ({ input }) => ({ status: 'found', record: input.record }) },
		notFound: {
			type: 'final',
			output: ({ context }) => ({ status: 'notFound', uri: context.uri })
		},
		failed: {
			type: 'final',
			output: () => {
				throw new Error('PDS record read failed')
			}
		},
		timedOut: {
			type: 'final',
			output: () => {
				throw new DOMException('PDS record read timed out', 'TimeoutError')
			}
		},
		cancelled: {
			type: 'final',
			output: () => {
				throw new DOMException('PDS record read cancelled', 'AbortError')
			}
		}
	}
})
