import { ArchivePayloadError, type PayloadLimits } from './types.js'

/** JSON.parse alone silently accepts duplicate keys, including escaped-key aliases. */
export function parsePayloadJson(source: string, limits: PayloadLimits): unknown {
	let position = 0
	let values = 0

	function fail(): never {
		throw new ArchivePayloadError('invalidJson')
	}

	function whitespace() {
		while (position < source.length) {
			const code = source.charCodeAt(position)
			if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return
			position += 1
		}
	}

	function string(): string {
		const start = position
		if (source[position] !== '"') return fail()
		position += 1
		while (position < source.length) {
			const character = source[position]
			position += 1
			if (character === '\\') {
				position += 1
				continue
			}
			if (character === '"') {
				let result: unknown
				try {
					result = JSON.parse(source.slice(start, position))
				} catch {
					return fail()
				}
				if (typeof result !== 'string') return fail()
				return result
			}
		}
		return fail()
	}

	function value(depth: number): unknown {
		values += 1
		if (depth > limits.depth || values > limits.jsonValues)
			throw new ArchivePayloadError('limitExceeded')
		whitespace()
		const character = source[position]
		if (character === '"') return string()
		if (character === '{') {
			position += 1
			whitespace()
			const entries: [string, unknown][] = []
			const keys = new Set<string>()
			if (source[position] === '}') {
				position += 1
				return Object.fromEntries(entries)
			}
			while (position < source.length) {
				whitespace()
				const key = string()
				if (keys.has(key)) throw new ArchivePayloadError('duplicateKey')
				keys.add(key)
				whitespace()
				if (source[position] !== ':') return fail()
				position += 1
				entries.push([key, value(depth + 1)])
				whitespace()
				const separator = source[position]
				position += 1
				if (separator === '}') return Object.fromEntries(entries)
				if (separator !== ',') return fail()
			}
			return fail()
		}
		if (character === '[') {
			position += 1
			whitespace()
			const result: unknown[] = []
			if (source[position] === ']') {
				position += 1
				return result
			}
			while (position < source.length) {
				result.push(value(depth + 1))
				whitespace()
				const separator = source[position]
				position += 1
				if (separator === ']') return result
				if (separator !== ',') return fail()
			}
			return fail()
		}
		for (const [literal, result] of [
			['true', true],
			['false', false],
			['null', null]
		]) {
			if (typeof literal === 'string' && source.startsWith(literal, position)) {
				position += literal.length
				return result
			}
		}
		// Numeric JSON fields are metadata counts/versions, never domain financial values.
		const start = position
		while (position < source.length && /[0-9eE+.-]/.test(source[position] ?? '')) position += 1
		if (start === position) return fail()
		const token = source.slice(start, position)
		if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token)) return fail()
		const result = Number(token)
		if (!Number.isFinite(result)) return fail()
		return result
	}

	const result = value(1)
	whitespace()
	if (position !== source.length) return fail()
	return result
}
