export async function stableUuid(namespaceId: string, name: string) {
	const namespaceHex = namespaceId.replaceAll('-', '')
	const namespaceBytes = Uint8Array.from(
		Array.from({ length: namespaceHex.length / 2 }, (_, index) =>
			Number.parseInt(namespaceHex.slice(index * 2, index * 2 + 2), 16)
		)
	)
	const nameBytes = new TextEncoder().encode(name)
	const input = new Uint8Array(namespaceBytes.length + nameBytes.length)
	input.set(namespaceBytes)
	input.set(nameBytes, namespaceBytes.length)
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', input))
	digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50
	digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80
	const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
