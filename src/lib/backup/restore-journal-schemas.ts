import { z } from 'zod'
import { wellFormed } from './schemas.js'
import { utf8ByteLength } from './utf8.js'

export const restoreJournalLimits = Object.freeze({
	bytes: 8 * 1024 * 1024,
	jsonValues: 500_000,
	depth: 16,
	recordMappings: 50_000,
	attachmentMappings: 5_000,
	mappings: 55_000,
	batches: 55_000
})

const exactText = (maximum: number) =>
	z
		.string()
		.min(1)
		.max(maximum)
		.refine(wellFormed)
		.refine((value) => utf8ByteLength(value) <= maximum)
const id = exactText(256)
const name = exactText(128)
const count = z
	.int()
	.nonnegative()
	.refine((value) => !Object.is(value, -0))
const positive = z.int().positive()
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const profile = z.strictObject({ id, version: positive }).readonly()
const source = z.strictObject({ applicationId: id, workspaceId: id }).readonly()
const operation = z
	.strictObject({
		applicationId: id,
		environment: id,
		identityId: id,
		operationId: id,
		destinationWorkspaceId: id
	})
	.readonly()
const recordMapping = { type: name, sourceId: id, destinationId: id }
const mapping = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('record'), ...recordMapping }).readonly(),
	z.strictObject({ kind: z.literal('reference'), ...recordMapping }).readonly(),
	z.strictObject({ kind: z.literal('attachment'), sourceId: id, destinationId: id }).readonly()
])
const write = { writeId: id, expectedContentSha256: sha256 }
const indexes = z
	.array(count.max(restoreJournalLimits.mappings - 1))
	.max(restoreJournalLimits.mappings)
	.readonly()
const preparation = z.strictObject({ ...write, mappingIndexes: indexes }).readonly()
const batch = z
	.strictObject({ ...write, mappingIndexes: indexes.unwrap().min(1).readonly() })
	.readonly()
const activation = z.strictObject(write).readonly()
const requirements = z
	.strictObject({
		local: z.enum(['required', 'notRequired']),
		remote: z.enum(['required', 'notRequired'])
	})
	.readonly()
	.refine((value) => value.local === 'required' || value.remote === 'required')

const intentShape = z
	.strictObject({
		operation,
		archive: z
			.strictObject({ archiveId: z.guid(), payloadSha256: sha256, profile, source })
			.readonly(),
		plan: z
			.strictObject({
				id,
				version: positive,
				sha256,
				expectedGraphSha256: sha256,
				mappings: z.array(mapping).max(restoreJournalLimits.mappings).readonly(),
				preparation,
				batches: z.array(batch).max(restoreJournalLimits.batches).readonly(),
				activation,
				requirements
			})
			.readonly()
	})
	.readonly()

/** Pure referential invariants. A structurally valid mapping is never a destination capability. */
function validIntent(intent: z.output<typeof intentShape>): boolean {
	const { plan } = intent
	const sourceRecords = new Map<string, Set<string>>()
	const sourceFiles = new Set<string>()
	const sourceIds = new Set<string>([intent.archive.source.workspaceId])
	const destinations = new Set<string>()
	let recordCount = 0
	for (const entry of plan.mappings) {
		sourceIds.add(entry.sourceId)
		if (destinations.has(entry.destinationId)) return false
		destinations.add(entry.destinationId)
		if (entry.kind === 'attachment') {
			if (sourceFiles.has(entry.sourceId)) return false
			sourceFiles.add(entry.sourceId)
		} else {
			recordCount += 1
			const ids = sourceRecords.get(entry.type) ?? new Set<string>()
			if (ids.has(entry.sourceId)) return false
			ids.add(entry.sourceId)
			sourceRecords.set(entry.type, ids)
		}
	}
	if (
		recordCount > restoreJournalLimits.recordMappings ||
		sourceFiles.size > restoreJournalLimits.attachmentMappings
	)
		return false
	if (sourceIds.has(intent.operation.destinationWorkspaceId)) return false
	for (const destination of destinations) if (sourceIds.has(destination)) return false

	const writeIds = new Set<string>([plan.activation.writeId])
	const assigned = new Set<number>()
	for (const group of [plan.preparation, ...plan.batches]) {
		if (writeIds.has(group.writeId)) return false
		writeIds.add(group.writeId)
		for (const index of group.mappingIndexes) {
			if (index >= plan.mappings.length || assigned.has(index)) return false
			assigned.add(index)
		}
	}
	return assigned.size === plan.mappings.length
}

export const restoreIntentSchema = intentShape.refine(validIntent)

const settlement = z
	.strictObject({
		local: z.enum(['unobserved', 'persisted', 'rejected']),
		remote: z.enum(['unobserved', 'accepted', 'rejected'])
	})
	.readonly()
const attemptFields = {
	issuance: positive,
	settlement,
	transactionId: id.nullable()
}
const attempt = z.strictObject(attemptFields).readonly()
const rejectedAttempt = z
	.strictObject({
		...attemptFields,
		transactionId: id,
		settlement: settlement
			.unwrap()
			.extend({ remote: z.literal('rejected') })
			.readonly()
	})
	.readonly()
const receiptFields = {
	writeId: id,
	...attemptFields,
	lastRejectedAttempt: rejectedAttempt.optional()
}
function validAttemptSequence(value: {
	issuance: number
	lastRejectedAttempt?: { issuance: number } | undefined
}): boolean {
	return (
		value.lastRejectedAttempt === undefined ||
		value.lastRejectedAttempt.issuance === value.issuance - 1
	)
}
const receipt = z.strictObject(receiptFields).readonly().refine(validAttemptSequence)
const current = z.discriminatedUnion('status', [
	z.strictObject({ status: z.literal('notIssued'), writeId: id, issuance: count }).readonly(),
	z
		.strictObject({ status: z.literal('issued'), ...receiptFields })
		.readonly()
		.refine(validAttemptSequence)
])
const reconciled = z
	.strictObject({
		basis: z.literal('remoteContentMatch'),
		writeId: id,
		contentSha256: sha256,
		localPersistence: z.enum(['unobserved', 'persisted']),
		attempt: receipt
	})
	.readonly()
	.refine((value) => value.writeId === value.attempt.writeId)
const completion = z.union([receipt, reconciled])
const completed = z
	.array(completion)
	.max(restoreJournalLimits.batches + 1)
	.readonly()
const comparison = z.strictObject({ payloadSha256: sha256, graphSha256: sha256 }).readonly()
const checkpoint = z.discriminatedUnion('kind', [
	z.strictObject({ kind: z.literal('writing'), completed, current }).readonly(),
	z.strictObject({ kind: z.literal('comparing'), completed }).readonly(),
	z.strictObject({ kind: z.literal('activating'), completed, comparison, current }).readonly(),
	z
		.strictObject({ kind: z.literal('complete'), completed, comparison, activation: completion })
		.readonly()
])
const conflict = z
	.strictObject({
		kind: z.literal('conflict'),
		reason: z.enum(['contentMismatch', 'destinationMismatch', 'operationMismatch']),
		prior: checkpoint
	})
	.readonly()
const record = z
	.strictObject({
		format: z.literal('DLF-RESTORE-JOURNAL'),
		version: z.literal(1),
		revision: count,
		intent: restoreIntentSchema,
		checkpoint: z.union([checkpoint, conflict])
	})
	.readonly()

function settled(
	value: z.output<typeof receipt>,
	required: z.output<typeof requirements>
): boolean {
	return (
		value.settlement.local !== 'rejected' &&
		value.settlement.remote !== 'rejected' &&
		(required.local !== 'required' || value.settlement.local === 'persisted') &&
		(required.remote !== 'required' || value.settlement.remote === 'accepted')
	)
}

function completedStep(
	value: z.output<typeof completion>,
	step: z.output<typeof activation>,
	required: z.output<typeof requirements>
): boolean {
	if (value.writeId !== step.writeId) return false
	if ('basis' in value)
		return (
			value.contentSha256 === step.expectedContentSha256 &&
			(required.local !== 'required' || value.localPersistence === 'persisted')
		)
	return settled(value, required)
}

/** Correlate receipts with their exact plan prefix; never infer settlement from a cursor alone. */
function validCheckpoint(value: z.output<typeof record>): boolean {
	const { intent } = value
	const progress = value.checkpoint.kind === 'conflict' ? value.checkpoint.prior : value.checkpoint
	const steps = [intent.plan.preparation, ...intent.plan.batches]
	if (progress.completed.length > steps.length) return false
	for (const [index, entry] of progress.completed.entries()) {
		const step = steps[index]
		if (!step || !completedStep(entry, step, intent.plan.requirements)) return false
	}
	if (value.revision === 0) {
		if (
			value.checkpoint.kind !== 'writing' ||
			value.checkpoint.completed.length !== 0 ||
			value.checkpoint.current.status !== 'notIssued' ||
			value.checkpoint.current.issuance !== 0
		)
			return false
	}
	if (progress.kind === 'writing')
		return progress.current.writeId === steps[progress.completed.length]?.writeId
	if (progress.completed.length !== steps.length) return false
	if (progress.kind === 'comparing') return true
	if (
		progress.comparison.payloadSha256 !== intent.archive.payloadSha256 ||
		progress.comparison.graphSha256 !== intent.plan.expectedGraphSha256
	)
		return false
	if (progress.kind === 'activating')
		return progress.current.writeId === intent.plan.activation.writeId
	return completedStep(progress.activation, intent.plan.activation, intent.plan.requirements)
}

export const restoreJournalSchema = record.refine(validCheckpoint)
export type RestoreJournalIntent = z.output<typeof restoreIntentSchema>
export type RestoreJournalRecord = z.output<typeof restoreJournalSchema>
export type RestoreJournalCheckpoint = RestoreJournalRecord['checkpoint']
export type RestoreJournalReceipt = z.output<typeof receipt>

export type RestoreJournalAttempt = z.output<typeof attempt>
export type RestoreJournalCompletion = z.output<typeof completion>
