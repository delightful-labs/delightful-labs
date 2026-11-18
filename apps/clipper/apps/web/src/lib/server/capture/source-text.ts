import { normalizeReaderText } from '../../annotations/schema.js'
import { CaptureError } from './errors.js'

/** Runs in the existing bounded parser worker. Original DOM text is captured
 * before Readability or reader transformations; no external resources execute. */
export async function sourceText(body: Uint8Array, mediaType: string, url: string) {
	if (/^text\/plain(;|$)/i.test(mediaType)) {
		const text = new TextDecoder(mediaType.match(/charset=["']?([^;"'\s]+)/i)?.[1] ?? 'utf-8', {
			fatal: true
		}).decode(body)
		if (text.length > 8_000_000) throw new CaptureError('sourceTooLarge', 413)
		return normalizeReaderText(text)
	}
	if (!/^(text\/html|application\/xhtml\+xml)(;|$)/i.test(mediaType))
		throw new CaptureError('unsupportedMedia', 415)
	const { JSDOM, VirtualConsole } = await import('jsdom')
	const dom = new JSDOM(Buffer.from(body), {
		url,
		contentType: mediaType,
		virtualConsole: new VirtualConsole()
	})
	try {
		const document = dom.window.document
		if (document.querySelectorAll('*').length > 50_000)
			throw new CaptureError('sourceTooLarge', 413)
		for (const node of document.querySelectorAll(
			'script,style,noscript,template,[hidden],[aria-hidden="true"]'
		))
			node.remove()
		const text = normalizeReaderText(document.body?.textContent ?? '')
		if (text.length > 8_000_000) throw new CaptureError('sourceTooLarge', 413)
		return text
	} finally {
		dom.window.close()
	}
}
