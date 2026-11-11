import { createLogger, debugEnabled, type DebugValue } from './logger.js'
import type { InspectionEvent } from 'xstate'

type Details = Record<string, DebugValue>
const logger = createLogger('state-machine')
const startupLogger = createLogger('jazz-startup')
const previousFailures = new WeakMap<object, string>()
// State names describe the current workflow position, and may include modeled
// outcomes such as denied or unavailable. Only explicit error/failure states
// indicate a diagnostic failure; terminal result outcomes are classified below.
const failureState = /error|failed|failure|rejected/i
const unsuccessfulOutcome = /error|failed|failure|invalid|unavailable|rejected|partial|denied/i
const containers = new Set([
	'result',
	'records',
	'assessment',
	'request',
	'operation',
	'scope',
	'report',
	'expected',
	'observed',
	'attempt'
])
const enums = new Set([
	'status',
	'outcome',
	'reason',
	'settlement',
	'phase',
	'stage',
	'kind',
	'purpose',
	'mode',
	'operation',
	'tier',
	'readTier'
])

// Only inspect data properties. Never invoke arbitrary getters on SDK objects.
function field(value: unknown, key: string): unknown {
	if (!value || typeof value !== 'object') return undefined
	return Object.getOwnPropertyDescriptor(value, key)?.value
}

export function diagnosticEventType(type: string) {
	return type.replace(/^(xstate\.(?:done\.actor|error\.actor|snapshot))\..+$/, '$1.[actor]')
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

function identifier(value: unknown): string | undefined {
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
	const name = field(error, 'name') ?? field(Object.getPrototypeOf(error), 'name')
	const details: Details = {
		type: identifier(name) ?? (error instanceof Error ? 'Error' : 'object')
	}
	const message = field(error, 'message')
	if (typeof message === 'string') details.message = diagnosticText(message)
	const code = identifier(field(error, 'code'))
	if (code) details.code = code
	const status = field(error, 'status') ?? field(error, 'statusCode')
	if (typeof status === 'number' && status >= 100 && status <= 599) details.status = status
	const stack = field(error, 'stack')
	if (typeof stack === 'string')
		details.frames = stack
			.split('\n')
			.filter((line) => /^\s*at /.test(line))
			.slice(0, 8)
			.map((line) => diagnosticText(line.trim(), true))
	const cause = diagnosticError(field(error, 'cause'), depth + 1, seen)
	if (cause) details.cause = cause
	const errors = field(error, 'errors')
	if (Array.isArray(errors)) {
		details.errorCount = errors.length
		details.errors = errors
			.slice(0, 4)
			.map((error: unknown) => diagnosticError(error, depth + 1, seen))
	}
	return details
}

function connection(db: unknown): DebugValue {
	const getConfig =
		field(db, 'getConfig') ??
		(db && typeof db === 'object' ? field(Object.getPrototypeOf(db), 'getConfig') : undefined)
	if (typeof getConfig !== 'function') return undefined
	try {
		const config: unknown = getConfig.call(db)
		return diagnosticJazzConfig(config)
	} catch {
		return { configAvailable: false }
	}
}

export function diagnosticJazzConfig(config: unknown): Details {
	const serverUrl = field(config, 'serverUrl')
	const appId = field(config, 'appId')
	return {
		appId: typeof appId === 'string' && /^[\w-]{1,100}$/.test(appId) ? appId : undefined,
		serverConfigured: typeof serverUrl === 'string' && serverUrl.length > 0,
		server: typeof serverUrl === 'string' ? diagnosticText(serverUrl) : undefined,
		environment: identifier(field(config, 'env'))
	}
}

export function logJazzInitializationFailure(config: unknown, error: unknown) {
	if (!debugEnabled) return
	try {
		startupLogger.error('Jazz session initialization failed', {
			...diagnosticJazzConfig(config),
			error: diagnosticError(error)
		})
	} catch {
		startupLogger.error('Jazz session initialization failed', { diagnosticsAvailable: false })
	}
}

/** Context facts, not context payloads: capabilities, counts, outcomes and correlation counters. */
export function diagnosticContext(context: unknown, depth = 0): Details {
	const details: Details = {}
	if (!context || typeof context !== 'object' || depth >= 4) return details
	const omitted: string[] = []
	for (const key of Object.keys(context).slice(0, 80)) {
		if (!/^[A-Za-z][A-Za-z0-9_]{0,48}$/.test(key)) continue
		const value = field(context, key)
		if (value === undefined) continue
		if (typeof value === 'boolean' || value === null) details[key] = value
		else if (key === 'error' || key === 'failure') details[key] = diagnosticError(value)
		else if (key === 'db') details.connection = connection(value)
		else if (Array.isArray(value)) details[`${key}Count`] = value.length
		else if (
			typeof value === 'number' &&
			Number.isFinite(value) &&
			/count|revision|generation|attempt|processed|imported|omitted|saved/i.test(key)
		)
			details[key] = value
		else if (typeof value === 'string' && enums.has(key))
			details[key] = identifier(value) ?? '[redacted]'
		else if (typeof value === 'string' && /Id$/.test(key))
			details[`has${key[0]?.toUpperCase()}${key.slice(1)}`] = value.length > 0
		else if (containers.has(key) && typeof value === 'object')
			details[key] = diagnosticContext(value, depth + 1)
		else omitted.push(key)
	}
	if (omitted.length) details.omittedFields = omitted
	return details
}

function statePaths(value: unknown, prefix = '', depth = 0): string[] {
	if (depth > 20) return []
	if (typeof value === 'string') return [`${prefix}${value}`]
	if (!value || typeof value !== 'object') return []
	return Object.keys(value).flatMap((key) =>
		statePaths(field(value, key), `${prefix}${key}.`, depth + 1)
	)
}

/** Observe only. This adapter never sends actor commands or owns workflow state. */
export function logMachineFailure(event: InspectionEvent) {
	if (!debugEnabled || (event.type !== '@xstate.transition' && event.type !== '@xstate.actor'))
		return
	try {
		const actorRef = event.actorRef
		const snapshot: unknown =
			event.type === '@xstate.transition' ? event.snapshot : actorRef.getSnapshot()
		const eventType = event.type === '@xstate.transition' ? event.eventType : 'xstate.init'
		if (!snapshot || typeof snapshot !== 'object') return
		const status = field(snapshot, 'status')
		const states = statePaths(field(snapshot, 'value'))
		const tags = field(snapshot, 'tags')
		const output = field(snapshot, 'output')
		const outcome = field(output, 'outcome')
		const failed =
			status === 'error' ||
			eventType === 'xstate.error.actor' ||
			(!(tags instanceof Set && tags.has('historical-outcome')) &&
				states.some((state) => failureState.test(state))) ||
			(tags instanceof Set &&
				[...tags].some((tag: unknown) => typeof tag === 'string' && failureState.test(tag))) ||
			(status === 'done' && typeof outcome === 'string' && unsuccessfulOutcome.test(outcome))
		if (!failed) {
			previousFailures.delete(actorRef)
			return
		}
		const context = field(snapshot, 'context')
		const error =
			field(snapshot, 'error') ??
			(event.type === '@xstate.transition' ? field(event.event, 'error') : undefined) ??
			field(context, 'error') ??
			field(field(context, 'result'), 'error') ??
			field(output, 'error')
		const machine = identifier(field(field(field(actorRef, 'logic'), 'config'), 'id'))
		const details: Details = {
			machine: machine ?? 'invoked-actor',
			actorSessionId: actorRef.sessionId,
			rootSessionId: event.rootId,
			status: identifier(status),
			states,
			event: diagnosticEventType(eventType),
			errorAvailable: error !== undefined && error !== null,
			error: diagnosticError(error),
			context: diagnosticContext(context),
			result: diagnosticContext(output)
		}
		const fingerprint = JSON.stringify({ ...details, event: undefined })
		if (previousFailures.get(actorRef) === fingerprint) return
		previousFailures.set(actorRef, fingerprint)
		logger.error('Machine entered an error state', details)
	} catch {
		logger.warn('Machine error diagnostics could not be collected')
	}
}
