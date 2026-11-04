import {
	encodeArchivePayload,
	parseArchivePayload,
	type ArchivePayload,
	type PayloadLimits
} from 'delightful-local-first/backup/archive'
import { notebookProfile } from './profile.js'

export function detachNotebookPayload(payload: unknown, limits?: PayloadLimits): ArchivePayload {
	const bytes = encodeArchivePayload(payload, limits)
	try {
		const result = parseArchivePayload(bytes, limits)
		if (!notebookProfile.validate(result)) throw new Error('Invalid notebook profile')
		return result
	} finally {
		bytes.fill(0)
	}
}
export interface NotebookData {
	toJSON(): { kind: 'notebookData' }
}
export interface NotebookWrite {
	toJSON(): { kind: 'notebookWrite' }
}
const payloads = new WeakMap<NotebookData, ArchivePayload>()
const writes = new WeakMap<NotebookWrite, { payload: unknown }>()
function retainNotebookPayload(payload: ArchivePayload): NotebookData {
	const data = Object.freeze({ toJSON: (): { kind: 'notebookData' } => ({ kind: 'notebookData' }) })
	payloads.set(data, payload)
	return data
}
export function createNotebookData(payload: unknown): NotebookData {
	return retainNotebookPayload(detachNotebookPayload(payload))
}
export function notebookPayload(data: NotebookData): ArchivePayload {
	const payload = payloads.get(data)
	if (payload === undefined) throw new Error('Notebook source unavailable')
	return payload
}
export function createNotebookWrite(payload: unknown): NotebookWrite {
	const write = Object.freeze({
		toJSON: (): { kind: 'notebookWrite' } => ({ kind: 'notebookWrite' })
	})
	writes.set(write, { payload })
	return write
}
export type NotebookTransformResult =
	| { ok: true; data: NotebookData }
	| { ok: false; error: unknown }
/** One bounded validation/normalization leaf. The chart decides whether to commit the result. */
export function validateNotebookWrite(write: NotebookWrite): NotebookTransformResult {
	try {
		const input = writes.get(write)
		if (input === undefined) throw new Error('Notebook write unavailable')
		writes.delete(write)
		return { ok: true, data: createNotebookData(input.payload) }
	} catch (error) {
		return { ok: false, error }
	}
}
/** One bounded synchronous capture leaf; no response or workflow decisions. */
export function captureNotebookData(
	data: NotebookData,
	limits: PayloadLimits
): NotebookTransformResult {
	try {
		return {
			ok: true,
			data: retainNotebookPayload(
				detachNotebookPayload(
					{
						...notebookPayload(data),
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
