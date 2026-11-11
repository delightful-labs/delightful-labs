const nonAscii = /[\u0080-\uffff]/

/** TextEncoder byte length without allocating output, including its lone-surrogate replacement. */
export function utf8ByteLength(text: string): number {
	if (!nonAscii.test(text)) return text.length
	let bytes = 0
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index)
		if (code <= 0x7f) bytes++
		else if (code <= 0x7ff) bytes += 2
		else if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(index + 1)
			if (next >= 0xdc00 && next <= 0xdfff) {
				bytes += 4
				index++
			} else bytes += 3
		} else bytes += 3
	}
	return bytes
}
