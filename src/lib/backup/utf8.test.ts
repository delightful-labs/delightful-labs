import { expect, it } from 'vitest'
import { utf8ByteLength } from './utf8.js'

const encoder = new TextEncoder()
it('matches native UTF-8 length for every UTF-16 code unit, including lone surrogates', () => {
	for (let code = 0; code <= 0xffff; code++) {
		const text = String.fromCharCode(code)
		if (utf8ByteLength(text) !== encoder.encode(text).length)
			throw new Error(`UTF-16 mismatch at ${code}`)
	}
})
it('matches native lengths for mixed text and every surrogate boundary combination', () => {
	const pieces = [
		'',
		'\0',
		'ASCII',
		'é',
		'界',
		'\ud7ff',
		'\ud800',
		'\udbff',
		'\udc00',
		'\udfff',
		'\ue000',
		'☕',
		'😀'
	]
	for (const left of pieces)
		for (const middle of pieces)
			for (const right of pieces) {
				const text = left + middle + right
				expect(utf8ByteLength(text)).toBe(encoder.encode(text).length)
			}
})
