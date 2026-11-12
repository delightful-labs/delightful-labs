import { z } from 'zod'
import { assetSchema } from '../capture/article-schema.js'
import { lowercaseUuidSchema } from '../validation/values.js'
import type { ActorRef, Snapshot } from 'xstate'
import type {
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from 'delightful-local-first/workspace/creation/contracts'

export type { SaveRequest } from '../storage/policy.js'
import type { SaveRequest, SourceMetadata } from '../storage/policy.js'
export type SyncReport = { type: 'SYNC'; id: string; status: 'accepted' | 'rejected' }
export type ReceiptWatch = { type: 'WATCH'; id: string; receipts: SyncReceipt[] }
export type SyncReceipt = { global: () => Promise<void> }
export type StoredAsset = z.infer<typeof assetSchema>
export const storageIntentSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	payloadHash: z.string()
})
export type StorageIntent = z.infer<typeof storageIntentSchema>
export type PreparedSave = {
	documentId: string
	source?: SourceMetadata
	intent: StorageIntent
	attachment: import('../capture/article-schema.js').Article
	images?: import('../images/schema.js').ArticleImage[]
}
export type SaveResult =
	| { kind: 'saved'; operationId: string; receipts: SyncReceipt[] }
	| { kind: 'failed' | 'unknown' | 'interrupted' | 'scopeChanged' | 'blocked'; operationId: string }
export type StageResult = WorkspaceCreationResult<PreparedSave, SyncReceipt>
export type StageInput = { attempt: WorkspaceCreationAttempt<PreparedSave> }
export type StageRef = import('xstate').ActorInstance<
	Snapshot<StageResult>,
	{ type: 'SHUTDOWN' | 'CANCEL' }
>
export type StageOperation = (
	spawn: import('../machines/children.js').ChildSpawner,
	input: StageInput
) => StageRef
export type SaveCapabilities = {
	isCurrent: () => boolean
	prepare: (request: SaveRequest) => Promise<PreparedSave>
	intent: StageOperation
	publish: StageOperation
}
export type AssetResult =
	| { kind: 'available'; bytes: Uint8Array; mediaType: string }
	| { kind: 'unavailable'; reason: 'missing' | 'invalid' }
export type ReadResult =
	| { kind: 'missing' | 'unavailable' | 'corrupt' }
	| {
			kind: 'available'
			document: import('../capture/document-schema.js').Document
			attachment: import('../capture/article-schema.js').Article
			text: string
			asset: AssetResult
			source: import('../capture/article-schema.js').CaptureSource | null
	  }
export type ReadOutcome = { kind: ReadResult['kind'] }
export type ReadReport = { type: 'READ_RESULT'; generation: number; result: ReadResult }
export type ReadInput = {
	id: string
	capability: ReadCapabilities
	generation?: number
	reportTo?: ActorRef<Snapshot<unknown>, ReadReport>
}
export type ReadCapabilities = {
	isCurrent: () => boolean
	/** Local replicas emit their current native link state, then changes, until released.
	 * Thin/server query facades do not own this connection and omit the capability. */
	observeConnection?:
		| ((next: (state: import('jazz-tools').LinkStatus['state']) => void) => () => void)
		| undefined
	document: (
		id: string,
		signal: AbortSignal
	) => Promise<import('../capture/document-schema.js').Document | null>
}
