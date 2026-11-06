import { fromCallback } from 'xstate'
import { z } from 'zod'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import type { BackupBinding } from 'delightful-local-first/backup/binding'
import type {
	RestoreJournalIntent,
	RestoreJournalRecord
} from 'delightful-local-first/backup/restore/journal'
import type { TestAppRestorePlanData } from './restore-plan.js'

type TestAppMappedExpected = {
	id: string
	sourceId: string
	writeId: string
	contentSha256: string
	payloadSha256: string
	destinationId: string
	ownerId: string
	operationId: string
}
export type TestAppAttachmentExpected = TestAppMappedExpected & {
	mediaType: string
	fileName: string
	sizeBytes: number
	sha256: string
	contents: Uint8Array<ArrayBuffer>
}
export type TestAppRootExpected = TestAppMappedExpected & { title: string }
export type TestAppNoteExpected = TestAppMappedExpected & {
	notebookId: string
	attachmentId: string | null
	body: string
	archived: boolean
}
export interface TestAppRestoreRequest {
	release(): void
	toJSON(): { kind: 'testAppRestoreRequest' }
}
export type TestAppRestoreOptions = {
	mode: 'new' | 'resume'
	binding: BackupBinding
	databaseName: string
	archive: IntegrityCheckedArchive
}
export type TestAppRestoreData = TestAppRestorePlanData & {
	options: TestAppRestoreOptions | undefined
	intent: RestoreJournalIntent | undefined
	releaseControl: (() => void) | undefined
	observedJournal: RestoreJournalRecord | undefined
	attachment: TestAppAttachmentExpected | undefined
	notebook: TestAppRootExpected | undefined
	notes: readonly TestAppNoteExpected[] | undefined
}
const requests = new WeakMap<
	TestAppRestoreRequest,
	{ data: TestAppRestoreData; claimed: boolean }
>()
function prepared(request: TestAppRestoreRequest) {
	const value = requests.get(request)
	if (!value) throw new Error('Invalid test app restore request')
	return value
}
/** Transfers checked-archive ownership. Resume requires the same operation binding and file. */
export function prepareTestAppRestore(options: TestAppRestoreOptions): TestAppRestoreRequest {
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
	if (!binding.success) throw new Error('Invalid test app restore binding')
	const captured = Object.freeze({ ...options, binding: binding.data })
	const data: TestAppRestoreData = {
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
		notebook: undefined,
		notes: undefined
	}
	const request: TestAppRestoreRequest = {
		release() {
			if (data.releaseControl) {
				data.releaseControl()
				return
			}
			clear(data)
		},
		toJSON: () => ({ kind: 'testAppRestoreRequest' })
	}
	requests.set(request, { data, claimed: false })
	return request
}
function clear(data: TestAppRestoreData) {
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
	data.notes = undefined
}
export function requiredTestAppRestoreValue<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing test app restore resource')
	return value
}

export function testAppRestoreData(input: { request: TestAppRestoreRequest }) {
	return prepared(input.request).data
}
/** Optional observation of root-owned data; absence is a destination admission decision. */
export function testAppRestoreNotes(request: TestAppRestoreRequest) {
	return requests.get(request)?.data.notes
}
export function testAppRestoreRoot(request: TestAppRestoreRequest) {
	return requests.get(request)?.data.notebook
}
export function testAppRestoreAttachment(request: TestAppRestoreRequest) {
	return requests.get(request)?.data.attachment
}
export function claimTestAppRestore(input: { request: TestAppRestoreRequest }): boolean {
	const value = requests.get(input.request)
	if (!value || value.claimed || !value.data.options) return false
	value.claimed = true
	return true
}
export const testAppRestoreResources = fromCallback<
	{ type: string },
	{ request: TestAppRestoreRequest }
>(({ input, sendBack }) => {
	const value = testAppRestoreData(input)
	value.releaseControl = () => sendBack({ type: 'RELEASE' })
	return () => {
		value.releaseControl = undefined
		clear(value)
	}
})
