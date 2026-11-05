import {
	encodeArchivePayload,
	parseArchivePayload,
	type ArchivePayload,
	type PayloadLimits
} from 'delightful-local-first/backup/archive'
import { testAppProfile } from './profile.js'

export function detachTestAppPayload(payload: unknown, limits?: PayloadLimits): ArchivePayload {
	const bytes = encodeArchivePayload(payload, limits)
	try {
		const result = parseArchivePayload(bytes, limits)
		if (!testAppProfile.validate(result)) throw new Error('Invalid notebook profile')
		return result
	} finally {
		bytes.fill(0)
	}
}
export interface TestAppData {
	toJSON(): { kind: 'testAppData' }
}
export interface TestAppWrite {
	toJSON(): { kind: 'testAppWrite' }
}
const payloads = new WeakMap<TestAppData, ArchivePayload>()
const writes = new WeakMap<TestAppWrite, { payload: unknown }>()
function retainTestAppPayload(payload: ArchivePayload): TestAppData {
	const data = Object.freeze({ toJSON: (): { kind: 'testAppData' } => ({ kind: 'testAppData' }) })
	payloads.set(data, payload)
	return data
}
export function createTestAppData(payload: unknown): TestAppData {
	return retainTestAppPayload(detachTestAppPayload(payload))
}
export function testAppPayload(data: TestAppData): ArchivePayload {
	const payload = payloads.get(data)
	if (payload === undefined) throw new Error('Test app source unavailable')
	return payload
}
export function createTestAppWrite(payload: unknown): TestAppWrite {
	const write = Object.freeze({
		toJSON: (): { kind: 'testAppWrite' } => ({ kind: 'testAppWrite' })
	})
	writes.set(write, { payload })
	return write
}
export type TestAppTransformResult = { ok: true; data: TestAppData } | { ok: false; error: unknown }
/** One bounded validation/normalization leaf. The chart decides whether to commit the result. */
export function validateTestAppWrite(write: TestAppWrite): TestAppTransformResult {
	try {
		const input = writes.get(write)
		if (input === undefined) throw new Error('Test app write unavailable')
		writes.delete(write)
		return { ok: true, data: createTestAppData(input.payload) }
	} catch (error) {
		return { ok: false, error }
	}
}
/** One bounded synchronous capture leaf; no response or workflow decisions. */
export function captureTestAppData(
	data: TestAppData,
	limits: PayloadLimits
): TestAppTransformResult {
	try {
		return {
			ok: true,
			data: retainTestAppPayload(
				detachTestAppPayload(
					{
						...testAppPayload(data),
						archiveId: crypto.randomUUID(),
						capturedAt: new Date().toISOString()
					},
					limits
				)
			)
		}
	} catch (error) {
		return { ok: false, error }
	}
}
