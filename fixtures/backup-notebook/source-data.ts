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
export function createNotebookData(payload: unknown): NotebookData {
	const data = Object.freeze({ toJSON: (): { kind: 'notebookData' } => ({ kind: 'notebookData' }) })
	payloads.set(data, detachNotebookPayload(payload))
	return data
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
export function applyNotebookWrite(write: NotebookWrite): NotebookData {
	const input = writes.get(write)
	if (input === undefined) throw new Error('Notebook write unavailable')
	writes.delete(write)
	return createNotebookData(input.payload)
}
