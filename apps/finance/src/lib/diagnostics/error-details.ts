import type { DebugValue } from 'delightful-local-first/diagnostics/logger'

type Details = Record<string, DebugValue>

// Only inspect data properties. Never invoke arbitrary getters on SDK objects.
export function diagnosticField(value: unknown, key: string): unknown {
	if (!value || typeof value !== 'object') return undefined
	return Object.getOwnPropertyDescriptor(value, key)?.value
}

/** Preserve technical wording while removing common embedded data/credential forms. */
export function diagnosticText(text: string, stackFrame = false): string {
	return text
		.slice(0, 4000)
		.replace(/\{[\s\S]*\}|\[[\s\S]*\]/g, '[payload redacted]')
		.replace(/(["'`])[^\n]*?\1/g, '[value redacted]')
		.replace(/\b[a-z][a-z+.-]*:\/\/[^\s)]+/gi, (url) => {
			try {
				const parsed = new URL(url)
				const source = stackFrame && /\.(?:[cm]?js|ts|svelte)(?::\d+){0,2}$/.test(parsed.pathname)
				return `${parsed.origin}${source ? parsed.pathname : ''}`
			} catch {
				return '[URL redacted]'
			}
		})
		.replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[authorization redacted]')
		.replace(
			/\b(?:secret|token|password|authorization|cookie|phrase|accessUrl|jwt|nonce|amountMinor|description|memo|accountName|email)\s*[:=]\s*[^\s,;]+/gi,
			'[value redacted]'
		)
		.replace(/\b[A-Za-z0-9_+\/=.-]{28,}\b/g, '[token redacted]')
		.replace(
			/\b(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b[\s\S]*/gi,
			'[query redacted]'
		)
		.replace(/\b(?:[a-z]{2,12}\s+){11,23}[a-z]{2,12}\b/g, '[text redacted]')
		.replace(/(?:\/Users|\/home)\/[^\s)]*?(?=\/(?:src|node_modules)\/)/g, '[project]')
		.slice(0, 1000)
}

export function diagnosticIdentifier(value: unknown): string | undefined {
	return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_. -]{0,79}$/.test(value)
		? value.replace(/[A-Za-z0-9_]{28,}/g, '[identifier redacted]')
		: undefined
}

export function diagnosticError(
	error: unknown,
	depth = 0,
	seen = new WeakSet<object>()
): DebugValue {
	if (error === undefined || error === null) return undefined
	if (typeof error === 'string') return { message: diagnosticText(error) }
	if (typeof error !== 'object') return { type: typeof error }
	if (seen.has(error) || depth >= 3) return { truncated: true }
	seen.add(error)
	const name =
		diagnosticField(error, 'name') ?? diagnosticField(Object.getPrototypeOf(error), 'name')
	const details: Details = {
		type: diagnosticIdentifier(name) ?? (error instanceof Error ? 'Error' : 'object')
	}
	const message = diagnosticField(error, 'message')
	if (typeof message === 'string') details.message = diagnosticText(message)
	const code = diagnosticIdentifier(diagnosticField(error, 'code'))
	if (code) details.code = code
	const status = diagnosticField(error, 'status') ?? diagnosticField(error, 'statusCode')
	if (typeof status === 'number' && status >= 100 && status <= 599) details.status = status
	const stack = diagnosticField(error, 'stack')
	if (typeof stack === 'string')
		details.frames = stack
			.split('\n')
			.filter((line) => /^\s*at /.test(line))
			.slice(0, 8)
			.map((line) => diagnosticText(line.trim(), true))
	const cause = diagnosticError(diagnosticField(error, 'cause'), depth + 1, seen)
	if (cause) details.cause = cause
	const errors = diagnosticField(error, 'errors')
	if (Array.isArray(errors)) {
		details.errorCount = errors.length
		details.errors = errors
			.slice(0, 4)
			.map((error: unknown) => diagnosticError(error, depth + 1, seen))
	}
	return details
}
