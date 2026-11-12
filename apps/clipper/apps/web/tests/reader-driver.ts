import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from './fixture-records.js'
import { projectReaderState } from '../src/lib/reader/schema.js'
export async function seedReader(url: string, paragraphCount = 70, codeHtml = '') {
	const records = currentLibraryRecords()
	const paragraphs = Array.from(
		{ length: paragraphCount },
		(_, index) =>
			`<p>Paragraph ${index + 1}. ${'Readable café 🦊 text with reliable context. '.repeat(14)}</p>`
	)
	const html = `<h3 id="start">Beginning</h3><p>Opening text with <a href="#fn1">Citation</a>.</p>${codeHtml}${paragraphs.slice(0, 35).join('')}<h3 id="middle">Middle chapter</h3>${paragraphs.slice(35).join('')}<h3 id="end">Ending</h3><ol><li id="fn1">A saved reader footnote.</li></ol>`
	const text = html.replace(/<[^>]*>/g, ' ')
	const result = await toPromise(
		createActor(records.articles.saveMachine, {
			input: {
				url,
				content: { title: 'Reader experience fixture', text, html, finalUrl: url, provenance: '{}' }
			}
		}).start()
	)
	if (result.kind !== 'saved' && result.kind !== 'duplicate')
		throw new Error('Expected saved reader fixture')
	await Promise.all(result.receipts.map((receipt) => receipt.global()))
	return result.operationId
}

/** Observe the independent test replica continuously, with the test page owning cleanup. */
let reading: ReturnType<typeof observeReading> | undefined
function observeReading() {
	const records = currentLibraryRecords()
	const ready = Promise.withResolvers<void>()
	let rows: import('../src/lib/reader/schema.js').ReaderOperation[] | undefined
	let documents: import('../src/lib/reader/schema.js').ReaderDocumentState[] | undefined
	let failed = false
	const updated = () => {
		if (rows && documents) ready.resolve()
	}
	const unavailable = () => {
		failed = true
		ready.reject(new Error('Reading fixture unavailable'))
	}
	const releases = [
		records.reader.capability.subscribe((next) => {
			rows = next
			updated()
		}, unavailable),
		records.reader.capability.subscribeDocuments((next) => {
			documents = next
			updated()
		}, unavailable)
	]
	window.addEventListener(
		'pagehide',
		() => {
			for (const release of releases) release()
		},
		{ once: true }
	)
	return ready.promise.then(() => () => {
		if (failed || !rows || !documents || !records.isCurrent())
			throw new Error('Reading fixture unavailable')
		return projectReaderState(rows, documents)
	})
}
export async function readingState() {
	return (await (reading ??= observeReading()))()
}
