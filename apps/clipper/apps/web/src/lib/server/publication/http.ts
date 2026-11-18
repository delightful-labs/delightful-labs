import { z } from 'zod'

export const publicationHeaders = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
export const publicationFailure = (status: number) =>
	new Response(null, { status, headers: publicationHeaders })

export function isPublicationPost(request: Request, origin: string) {
	return (
		request.method === 'POST' &&
		!request.headers.has('authorization') &&
		request.headers.get('origin') === origin &&
		new URL(request.url).origin === origin
	)
}

export function isJsonRequest(request: Request) {
	return (
		request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() === 'application/json'
	)
}

/** One bounded native stream read; its request chart owns admission and lifetime. */
export async function readPublicationInput<Schema extends z.ZodType>(
	request: Request,
	signal: AbortSignal,
	schema: Schema,
	limit: number
) {
	const reader = request.body?.getReader()
	if (!reader) throw new Error('Missing publication input')
	const abort = () => {
		void reader.cancel().catch(() => {})
	}
	signal.addEventListener('abort', abort, { once: true })
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		signal.throwIfAborted()
		for (;;) {
			const next = await reader.read()
			if (next.done) break
			length += next.value.byteLength
			if (length > limit) throw new Error('Publication input too large')
			chunks.push(next.value)
		}
	} finally {
		signal.removeEventListener('abort', abort)
		void reader.cancel().catch(() => {})
		reader.releaseLock()
	}
	signal.throwIfAborted()
	const bytes = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}
	const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
	return schema.parse(value)
}
