import type { InspectionEvent } from 'xstate'

function field(value: unknown, key: string): unknown {
	return value && typeof value === 'object'
		? Object.getOwnPropertyDescriptor(value, key)?.value
		: undefined
}
function label(value: unknown): string | undefined {
	return typeof value === 'string' && /^[A-Za-z_#][A-Za-z0-9_.:# -]{0,199}$/.test(value)
		? value
		: undefined
}
function state(value: unknown, depth = 0): unknown {
	if (depth > 40) return undefined
	if (typeof value === 'string') return label(value)
	if (!value || typeof value !== 'object') return undefined
	return Object.fromEntries(
		Object.keys(value)
			.slice(0, 100)
			.filter((key) => label(key))
			.map((key) => [key, state(field(value, key), depth + 1)])
	)
}
export function inspectionSnapshot(snapshot: unknown) {
	const status = field(snapshot, 'status')
	return {
		status: status === 'done' || status === 'error' || status === 'stopped' ? status : 'active',
		value: state(field(snapshot, 'value')),
		output: undefined,
		error: undefined
	}
}
const structural = new Set([
	'id',
	'initial',
	'type',
	'states',
	'on',
	'after',
	'target',
	'invoke',
	'src'
])
function definition(value: unknown, depth = 0, map = false): unknown {
	if (depth > 100) return undefined
	if (typeof value === 'string') return label(value)
	if (!value || typeof value !== 'object') return undefined
	if (Array.isArray(value)) return value.slice(0, 100).map((entry) => definition(entry, depth + 1))
	return Object.fromEntries(
		Object.keys(value)
			.slice(0, 500)
			.filter((key) => (map ? label(key) : structural.has(key)))
			.map((key) => [
				key,
				definition(
					field(value, key),
					depth + 1,
					key === 'states' || key === 'on' || key === 'after'
				)
			])
	)
}
/** Hosted inspector transport DTOs, projected from v6's native protocol before
 * buffering. No live actor, context, input, output, error or action params escape. */
export function projectInspection(event: InspectionEvent) {
	const sessionId = event.actorRef.sessionId
	if (!sessionId) return undefined
	const common = {
		sessionId,
		rootId: event.rootId,
		id: null,
		_version: '0.7.2',
		createdAt: Date.now().toString()
	}
	if (event.type === '@xstate.actor') {
		const config = field(event.src, 'config')
		return {
			...common,
			type: '@xstate.actor',
			parentId: event.parentRef?.sessionId,
			name: label(field(config, 'id')) ?? sessionId,
			definition: JSON.stringify(definition(config) ?? { id: sessionId }),
			snapshot: inspectionSnapshot(event.snapshot)
		}
	}
	return {
		...common,
		type: '@xstate.snapshot',
		event: { type: label(event.eventType) ?? '[event redacted]' },
		snapshot: inspectionSnapshot(event.snapshot)
	}
}
export type ProjectedInspection = NonNullable<ReturnType<typeof projectInspection>>
