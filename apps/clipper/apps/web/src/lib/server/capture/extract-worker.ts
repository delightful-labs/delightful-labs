import { z } from 'zod'
import { sourceText } from './source-text.js'
import { parserInputSchema } from './parser-protocol.js'
import { parentPort, workerData } from 'node:worker_threads'
import { extract } from './extract.js'
import { CaptureError } from './errors.js'
import type { ParserReply } from './parser-protocol.js'
async function run() {
	const input: unknown = workerData
	const parsed = parserInputSchema
		.extend({ mode: z.enum(['extract', 'source']).default('extract') })
		.safeParse(input)
	if (!parsed.success) throw new CaptureError('invalidInput', 400)
	return parsed.data.mode === 'source'
		? sourceText(parsed.data.body, parsed.data.mediaType, parsed.data.url)
		: extract(parsed.data.body, parsed.data.mediaType, parsed.data.url)
}
try {
	const value = await run()
	parentPort?.postMessage({ kind: 'success', value } satisfies ParserReply<
		import('./parser-protocol.js').ExtractedContent | string
	>)
} catch (error) {
	const failure = error instanceof CaptureError ? error : new CaptureError('parseFailed', 422)
	parentPort?.postMessage({
		kind: 'failed',
		code: failure.code,
		status: failure.status,
		retryable: failure.retryable
	} satisfies ParserReply)
} finally {
	parentPort?.close()
}
