/** Callers choose non-sensitive fields; this type is not a runtime sanitizer. */
export type DebugValue =
	| string
	| number
	| boolean
	| null
	| undefined
	| readonly DebugValue[]
	| { readonly [key: string]: DebugValue }

export type LogDetails = Readonly<Record<string, DebugValue>>
export type Logger = Readonly<{
	info: (message: string, details?: LogDetails) => void
	warn: (message: string, details?: LogDetails) => void
	error: (message: string, details?: LogDetails) => void
}>
export type LogSink = Readonly<{
	info: (message: string, details: LogDetails) => void
	warn: (message: string, details: LogDetails) => void
	error: (message: string, details: LogDetails) => void
}>
export type LoggerOptions = Readonly<{
	/** Explicit host policy; development mode alone never enables logging. */
	enabled: boolean
	sink?: LogSink
}>

/** Scoped synchronous output only: no environment lookup, buffering, persistence or SDK hooks. */
export function createLogger(scope: string, options: LoggerOptions = { enabled: false }): Logger {
	const enabled = options.enabled === true
	const { sink } = options
	return {
		info(message, details = {}) {
			if (enabled) (sink ?? console).info(`[${scope}] ${message}`, details)
		},
		warn(message, details = {}) {
			if (enabled) (sink ?? console).warn(`[${scope}] ${message}`, details)
		},
		error(message, details = {}) {
			if (enabled) (sink ?? console).error(`[${scope}] ${message}`, details)
		}
	}
}
