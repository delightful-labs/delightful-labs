import { createArchivePayloadError, type PayloadLimits } from './types.js'
import { utf8ByteLength } from './utf8.js'

/** Bounds caller-supplied data BEFORE schema cloning/error collection; does not validate shapes. */
export function checkPayloadBudget(input: unknown, limits: PayloadLimits): void {
	let values = 0
	let stringBytes = 0
	function text(value: string) {
		if (value.length > limits.payloadBytes) throw createArchivePayloadError('limitExceeded')
		stringBytes += utf8ByteLength(value)
		if (stringBytes > limits.payloadBytes) throw createArchivePayloadError('limitExceeded')
	}
	function visit(value: unknown, depth: number) {
		values += 1
		if (depth > limits.depth || values > limits.jsonValues)
			throw createArchivePayloadError('limitExceeded')
		if (typeof value === 'string') {
			text(value)
			return
		}
		if (value === null || typeof value === 'number' || typeof value === 'boolean') return
		if (typeof value !== 'object') throw createArchivePayloadError('invalidPayload')
		const array = Array.isArray(value)
		const prototype: unknown = Object.getPrototypeOf(value)
		if (!array && prototype !== Object.prototype && prototype !== null)
			throw createArchivePayloadError('invalidPayload')
		if (array && value.length > limits.jsonValues - values)
			throw createArchivePayloadError('limitExceeded')
		const keys = Reflect.ownKeys(value)
		if (keys.length > limits.jsonValues - values + 1)
			throw createArchivePayloadError('limitExceeded')
		if (array && keys.length !== value.length + 1) throw createArchivePayloadError('invalidPayload')
		for (const key of keys) {
			if (array && key === 'length') continue
			if (typeof key !== 'string') throw createArchivePayloadError('invalidPayload')
			if (array && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
				throw createArchivePayloadError('invalidPayload')
			if (!array) text(key)
			const descriptor = Object.getOwnPropertyDescriptor(value, key)
			if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
				throw createArchivePayloadError('invalidPayload')
			const child: unknown = descriptor.value
			visit(child, depth + 1)
		}
	}
	visit(input, 1)
}
