import { fromCallback } from 'xstate'
import { z } from 'zod'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import type { BackupBinding } from 'delightful-local-first/backup/export'
import type {
	RestoreJournalIntent,
	RestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'
import type { NotebookRestorePlanData } from './restore-plan.js'

type NotebookMappedExpected = {
	id: string
	sourceId: string
	writeId: string
	contentSha256: string
	payloadSha256: string
	destinationId: string
	ownerId: string
	operationId: string
}
export type NotebookAttachmentExpected = NotebookMappedExpected & {
	mediaType: string
	fileName: string
	sizeBytes: number
	sha256: string
	contents: Uint8Array<ArrayBuffer>
}
export type NotebookRootExpected = NotebookMappedExpected & { title: string }
export interface NotebookRestoreRequest {
	release(): void
	toJSON(): { kind: 'notebookRestoreRequest' }
}
export type NotebookRestoreOptions = {
	mode: 'new' | 'resume'
	binding: BackupBinding
	databaseName: string
	archive: IntegrityCheckedArchive
}
export type NotebookRestoreData = NotebookRestorePlanData & {
	options: NotebookRestoreOptions | undefined
	intent: RestoreJournalIntent | undefined
	releaseControl: (() => void) | undefined
	observedJournal: RestoreJournalRecord | undefined
	attachment: NotebookAttachmentExpected | undefined
	notebook: NotebookRootExpected | undefined
}
const requests = new WeakMap<
	NotebookRestoreRequest,
	{ data: NotebookRestoreData; claimed: boolean }
>()
function prepared(request: NotebookRestoreRequest) {
	const value = requests.get(request)
	if (!value) throw new Error('Invalid notebook restore request')
	return value
}
/** Transfers checked-archive ownership. Resume requires the same operation binding and file. */
export function prepareNotebookRestore(options: NotebookRestoreOptions): NotebookRestoreRequest {
	const binding = z
		.strictObject({
			applicationId: z.string().min(1).max(256),
			environment: z.string().min(1).max(256),
			identityId: z.uuid(),
			workspaceId: z.uuid(),
			generation: z.int().nonnegative(),
			operationId: z.string().min(1).max(256)
		})
		.readonly()
		.safeParse(options.binding)
	if (!binding.success) throw new Error('Invalid notebook restore binding')
	const captured = Object.freeze({ ...options, binding: binding.data })
	const data: NotebookRestoreData = {
		options: captured,
		archive: captured.archive,
		binding: captured.binding,
		mappings: [],
		graph: '',
		graphSha256: '',
		preparation: '',
		preparationSha256: '',
		batches: [],
		activation: '',
		activationSha256: '',
		intent: undefined,
		releaseControl: undefined,
		observedJournal: undefined,
		attachment: undefined,
		notebook: undefined
	}
	const request: NotebookRestoreRequest = {
		release() {
			if (data.releaseControl) {
				data.releaseControl()
				return
			}
			clear(data)
		},
		toJSON: () => ({ kind: 'notebookRestoreRequest' })
	}
	requests.set(request, { data, claimed: false })
	return request
}
function clear(data: NotebookRestoreData) {
	data.archive.release()
	data.options = undefined
	data.graph = ''
	data.preparation = ''
	data.activation = ''
	data.batches = []
	data.mappings = []
	data.intent = undefined
	data.observedJournal = undefined
	data.attachment = undefined
	data.notebook = undefined
}
export function requiredNotebookRestoreValue<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing notebook restore resource')
	return value
}

export function notebookRestoreData(input: { request: NotebookRestoreRequest }) {
	return prepared(input.request).data
}
/** Optional observation of root-owned data; absence is a destination admission decision. */
export function notebookRestoreRoot(request: NotebookRestoreRequest) {
	return requests.get(request)?.data.notebook
}
export function notebookRestoreAttachment(request: NotebookRestoreRequest) {
	return requests.get(request)?.data.attachment
}
export function claimNotebookRestore(input: { request: NotebookRestoreRequest }): boolean {
	const value = requests.get(input.request)
	if (!value || value.claimed || !value.data.options) return false
	value.claimed = true
	return true
}
export const notebookRestoreResources = fromCallback<
	{ type: string },
	{ request: NotebookRestoreRequest }
>(({ input, sendBack }) => {
	const value = notebookRestoreData(input)
	value.releaseControl = () => sendBack({ type: 'RELEASE' })
	return () => {
		value.releaseControl = undefined
		clear(value)
	}
})
