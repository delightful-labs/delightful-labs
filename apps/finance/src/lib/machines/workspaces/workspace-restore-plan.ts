import { z } from 'zod'
import { schema as s } from 'jazz-tools'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import type { ArchivePayload } from 'delightful-local-first/backup/archive'
import type { BackupBinding } from 'delightful-local-first/backup/binding'
import { sameBackupBinding } from 'delightful-local-first/backup/binding'
import {
	createRestoreJournalRecord,
	type RestoreJournalIntent
} from 'delightful-local-first/backup/restore/journal'
import { decodeFinanceBackup } from '../../backup/workspace.js'
import {
	app,
	type Organization,
	type Account,
	type Category,
	type Tag,
	type TransactionRow,
	type InternalTransfer
} from '../../schema.js'
import { stableUuid } from '../../domain/stable-uuid.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

/** Typed restore plan; no destination client, writes or access grants are acquired here. */
export type FinanceRestoreGraph = {
	workspace: Organization
	accounts: (Omit<Account, 'archivedAt'> & { archivedAt: string | null })[]
	categories: (Omit<Category, 'archivedAt'> & { archivedAt: string | null })[]
	tags: (Omit<Tag, 'archivedAt'> & { archivedAt: string | null })[]
	transactions: TransactionRow[]
	transfers: InternalTransfer[]
	checks: s.RowOf<typeof app.checks>[]
	transactionTags: s.RowOf<typeof app.transactionTags>[]
	batches: s.RowOf<typeof app.transactionBatches>[]
	templates: s.RowOf<typeof app.batchTemplates>[]
	files: s.RowOf<typeof app.files>[]
	links: s.RowOf<typeof app.transactionAttachments>[]
	parts: { id: string; fileId: string; partIndex: number; sizeBytes: number; data: number[] }[]
	member: s.RowOf<typeof app.organizationMembers>
	source: {
		file: s.RowOf<typeof app.files>
		parts: Omit<s.RowOf<typeof app.fileParts>, 'data'>[]
	}
}
export type FinanceRestorePlan = { graph: FinanceRestoreGraph; intent: RestoreJournalIntent }
export type FinanceRestorePlanRequest = {
	toJSON(): { kind: 'financeRestorePlan' }
	read(): FinanceRestorePlan
	release(): void
}
const compare = (left: string, right: string) => (left === right ? 0 : left < right ? -1 : 1)
export function canonicalRecovery(value: unknown): string {
	if (value instanceof Date) return JSON.stringify(value.toISOString())
	if (value instanceof Uint8Array) return canonicalRecovery([...value])
	if (Array.isArray(value)) return '[' + value.map(canonicalRecovery).join(',') + ']'
	if (value && typeof value === 'object')
		return (
			'{' +
			Object.entries(value)
				.sort(([a], [b]) => compare(a, b))
				.map(([key, item]) => JSON.stringify(key) + ':' + canonicalRecovery(item))
				.join(',') +
			'}'
		)
	const encoded = JSON.stringify(value)
	if (encoded === undefined) throw new Error('Unsupported restore value')
	return encoded
}
export const digestRecovery = (value: unknown) =>
	crypto.subtle
		.digest('SHA-256', new TextEncoder().encode(canonicalRecovery(value)))
		.then((digest) =>
			[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
		)
export const financeGraphRows = (graph: FinanceRestoreGraph) => [
	graph.accounts,
	graph.categories,
	graph.tags,
	graph.checks,
	graph.batches,
	graph.templates,
	graph.transactions,
	graph.transactionTags,
	graph.transfers,
	graph.files,
	graph.links,
	graph.parts
]
type Decoded = ReturnType<typeof decodeFinanceBackup>
type PlanDraft = Omit<RestoreJournalIntent['plan'], 'sha256'>
type PrivateValue<Value> = { read(): Value; toJSON(): { kind: string }; release(): void }
type PlanRequestData = {
	archive: IntegrityCheckedArchive
	binding: BackupBinding
	previous: RestoreJournalIntent | undefined
	artifacts: Set<{ release(): void }>
	plan?: FinanceRestorePlan
}
const plans = new WeakMap<FinanceRestorePlanRequest, PlanRequestData>()
function data(request: FinanceRestorePlanRequest) {
	const value = plans.get(request)
	if (!value) throw new Error('Released restore plan')
	return value
}
const required = <Value>(value: Value | undefined): Value => {
	if (value === undefined) throw new Error('Missing planning input')
	return value
}
// Byte custody only. The chart owns every intermediate value and admission decision.
function privateValue<Value>(
	request: FinanceRestorePlanRequest,
	kind: string,
	value: Value,
	dispose?: (value: Value) => void
): PrivateValue<Value> {
	let retained: Value | undefined = value
	const handle = {
		read: () => required(retained),
		toJSON: () => ({ kind }),
		release() {
			if (retained !== undefined) dispose?.(retained)
			retained = undefined
		}
	}
	data(request).artifacts.add(handle)
	return handle
}
export function prepareFinanceRestorePlan(
	archive: IntegrityCheckedArchive,
	binding: BackupBinding,
	previous?: RestoreJournalIntent
): FinanceRestorePlanRequest {
	const request: FinanceRestorePlanRequest = {
		toJSON: () => ({ kind: 'financeRestorePlan' }),
		read: () => {
			const plan = data(request).plan
			if (!plan) throw new Error('Restore plan is not ready')
			return plan
		},
		release: () => {
			for (const value of plans.get(request)?.artifacts ?? []) value.release()
			plans.delete(request)
		}
	}
	plans.set(request, { archive, binding: { ...binding }, previous, artifacts: new Set() })
	return request
}
const key = (kind: string, type: string, id: string) => JSON.stringify([kind, type, id])
const partKey = (id: string, index: number) => key('part', id, String(index))
export const restorePartBytes = 256 * 1024
const partBytes = restorePartBytes
const sourceIdentity = (archiveId: string) => 'payload/' + archiveId
type Source = { payload: ArchivePayload; sourceSize: number; payloadSha256: string }
type IdentitySource = { kind: 'record' | 'attachment'; type: string; sourceId: string }
type IdentityIndex = { sources: IdentitySource[]; physicalNames: string[] }
function sourceScopeMatches(binding: BackupBinding, source: Source) {
	return (
		z.uuid().safeParse(binding.identityId).success &&
		z.uuid().safeParse(binding.operationId).success &&
		binding.workspaceId === source.payload.source.workspaceId
	)
}
function savedIntentMatches(
	binding: BackupBinding,
	previous: RestoreJournalIntent | undefined,
	source: Source
) {
	const { payload, payloadSha256 } = source
	return (
		previous === undefined ||
		(previous.operation.applicationId === binding.applicationId &&
			previous.operation.environment === binding.environment &&
			previous.operation.identityId === binding.identityId &&
			previous.operation.operationId === binding.operationId &&
			previous.archive.payloadSha256 === payloadSha256 &&
			previous.archive.archiveId === payload.archiveId &&
			canonicalRecovery(previous.archive.profile) === canonicalRecovery(payload.profile) &&
			canonicalRecovery(previous.archive.source) === canonicalRecovery(payload.source))
	)
}
function indexIdentities({ payload, sourceSize }: Source, decoded: Decoded): IdentityIndex {
	const attachments = financialAttachments(payload, decoded)
	return {
		sources: [
			...payload.records.map((row): IdentitySource => ({
				kind: 'record',
				type: row.type,
				sourceId: row.id
			})),
			...attachments.map((file): IdentitySource => ({
				kind: 'attachment',
				type: '',
				sourceId: file.id
			}))
		].sort((a, b) => compare(key(a.kind, a.type, a.sourceId), key(b.kind, b.type, b.sourceId))),
		physicalNames: [
			'owner-membership',
			'source-payload',
			...Array.from({ length: Math.ceil(sourceSize / partBytes) }, (_, index) =>
				partKey(sourceIdentity(payload.archiveId), index)
			),
			...attachments.flatMap((file) =>
				Array.from({ length: Math.ceil(file.sizeBytes / partBytes) }, (_, index) =>
					partKey(file.id, index)
				)
			)
		]
	}
}
function savedMappingsMatch(
	previous: RestoreJournalIntent | undefined,
	{ sources }: IdentityIndex
) {
	const saved = previous?.plan.mappings
	return (
		saved === undefined ||
		(saved.length === sources.length &&
			sources.every((source, index) => {
				const old = saved[index]
				return (
					old !== undefined &&
					old.kind === source.kind &&
					old.sourceId === source.sourceId &&
					(old.kind === 'attachment' || old.type === source.type) &&
					z.uuid().safeParse(old.destinationId).success
				)
			}))
	)
}
const mappingKey = (mapping: RestoreJournalIntent['plan']['mappings'][number]) =>
	key(mapping.kind, mapping.kind === 'attachment' ? '' : mapping.type, mapping.sourceId)
function newMappings(
	index: IdentityIndex,
	ids: Map<string, string>
): RestoreJournalIntent['plan']['mappings'] {
	return index.sources.map((source) => {
		const destinationId = required(ids.get(key(source.kind, source.type, source.sourceId)))
		return source.kind === 'attachment'
			? { kind: 'attachment', sourceId: source.sourceId, destinationId }
			: { kind: 'record', type: source.type, sourceId: source.sourceId, destinationId }
	})
}
type SourceAudit = Pick<
	Decoded['organizations'][number],
	| 'sourceCreatedAt'
	| 'sourceUpdatedAt'
	| 'sourceCreatedBy'
	| 'sourceUpdatedBy'
	| 'sourceCreatedIssuer'
	| 'sourceCreatedSubject'
	| 'sourceUpdatedIssuer'
	| 'sourceUpdatedSubject'
>
function business<Row extends SourceAudit>(row: Row) {
	const {
		sourceCreatedAt: _ca,
		sourceUpdatedAt: _ua,
		sourceCreatedBy: _cb,
		sourceUpdatedBy: _ub,
		sourceCreatedIssuer: _ci,
		sourceCreatedSubject: _cs,
		sourceUpdatedIssuer: _ui,
		sourceUpdatedSubject: _us,
		...domain
	} = row
	return domain
}
const ordered = <Row extends { id: string }>(rows: Row[]) =>
	rows.sort((a, b) => compare(a.id, b.id))
function financialAttachments(payload: ArchivePayload, decoded: Decoded) {
	const ids = new Set(decoded.files.map((file) => file.id))
	return payload.attachments.filter((file) => ids.has(file.id))
}
function project(
	{ payload, sourceSize }: Source,
	rows: Decoded,
	ids: Map<string, string>,
	binding: BackupBinding
): FinanceRestoreGraph {
	const mapped = (type: string, id: string) => {
		const result = ids.get(key('record', type, id))
		if (!result) throw new Error('Unmapped restore reference')
		return result
	}
	const optional = (type: string, id: string | null) => (id === null ? null : mapped(type, id))
	const physical = (name: string) => {
		const id = ids.get(name)
		if (!id) throw new Error('Missing physical restore ID')
		return id
	}
	const root = required(rows.organizations[0])
	const workspaceId = mapped('organizations', root.id)
	const sourceId = sourceIdentity(payload.archiveId),
		sourceFileId = physical('source-payload')
	const graph: FinanceRestoreGraph = {
		source: {
			file: {
				id: sourceFileId,
				transactionId: null,
				accountId: null,
				organizationId: workspaceId,
				fileName: 'source-' + payload.archiveId + '.json',
				mimeType: 'application/json',
				sizeBytes: sourceSize
			},
			parts: Array.from({ length: Math.ceil(sourceSize / partBytes) }, (_, index) => ({
				id: physical(partKey(sourceId, index)),
				fileId: sourceFileId,
				partIndex: index,
				sizeBytes: Math.min(partBytes, sourceSize - index * partBytes)
			}))
		},
		workspace: { ...business(root), id: workspaceId, ownerId: binding.identityId },
		accounts: ordered(
			rows.accounts.map((row) => ({
				...business(row),
				id: mapped('accounts', row.id),
				organizationId: workspaceId,
				archivedAt: row.archivedAt?.toISOString() ?? null
			}))
		),
		categories: ordered(
			rows.categories.map((row) => ({
				...business(row),
				id: mapped('categories', row.id),
				organizationId: workspaceId,
				archivedAt: row.archivedAt?.toISOString() ?? null
			}))
		),
		tags: ordered(
			rows.tags.map((row) => ({
				...business(row),
				id: mapped('tags', row.id),
				organizationId: workspaceId,
				categoryId: optional('categories', row.categoryId),
				archivedAt: row.archivedAt?.toISOString() ?? null
			}))
		),
		checks: ordered(
			rows.checks.map((row) => ({
				...business(row),
				id: mapped('checks', row.id),
				organizationId: workspaceId,
				accountId: mapped('accounts', row.accountId)
			}))
		),
		batches: ordered(
			rows.transactionBatches.map((row) => ({
				...business(row),
				id: mapped('transactionBatches', row.id),
				organizationId: workspaceId
			}))
		),
		templates: ordered(
			rows.batchTemplates.map((row) => ({
				...business(row),
				id: mapped('batchTemplates', row.id),
				organizationId: workspaceId
			}))
		),
		transactions: ordered(
			rows.transactions.map((row) => ({
				...business(row),
				id: mapped('transactions', row.id),
				organizationId: workspaceId,
				accountId: mapped('accounts', row.accountId),
				categoryId: mapped('categories', row.categoryId),
				checkId: optional('checks', row.checkId),
				batchId: optional('transactionBatches', row.batchId),
				internalTransferId: optional('internalTransfers', row.internalTransferId)
			}))
		),
		transactionTags: ordered(
			rows.transactionTags.map((row) => ({
				...business(row),
				id: mapped('transactionTags', row.id),
				organizationId: workspaceId,
				transactionId: mapped('transactions', row.transactionId),
				tagId: mapped('tags', row.tagId)
			}))
		),
		transfers: ordered(
			rows.internalTransfers.map((row) => ({
				...business(row),
				id: mapped('internalTransfers', row.id),
				organizationId: workspaceId,
				expenseTransactionId: mapped('transactions', row.expenseTransactionId),
				incomeTransactionId: mapped('transactions', row.incomeTransactionId),
				expenseAccountId: optional('accounts', row.expenseAccountId),
				incomeAccountId: optional('accounts', row.incomeAccountId)
			}))
		),
		files: ordered(
			rows.files.map((row) => ({
				...business(row),
				id: mapped('files', row.id),
				transactionId: mapped('transactions', row.transactionId),
				organizationId: optional('organizations', row.organizationId),
				accountId: optional('accounts', row.accountId)
			}))
		),
		links: ordered(
			rows.transactionAttachments.map((row) => ({
				...business(row),
				id: mapped('transactionAttachments', row.id),
				transactionId: mapped('transactions', row.transactionId),
				fileId: mapped('files', row.fileId)
			}))
		),
		parts: financialAttachments(payload, rows)
			.flatMap((file) => {
				const raw = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
				return Array.from({ length: Math.ceil(raw.length / partBytes) }, (_, index) => ({
					id: physical(partKey(file.id, index)),
					fileId: mapped('files', file.id),
					partIndex: index,
					sizeBytes: Math.min(partBytes, raw.length - index * partBytes),
					data: [...raw.subarray(index * partBytes, (index + 1) * partBytes)]
				}))
			})
			.sort((a, b) => compare(a.fileId, b.fileId) || a.partIndex - b.partIndex),
		member: {
			id: physical('owner-membership'),
			organizationId: workspaceId,
			userId: binding.identityId,
			profileId: null,
			role: 'owner',
			accountAccessMode: 'all'
		}
	}
	return graph
}
function identitiesAreUnique(
	payload: ArchivePayload,
	mappings: RestoreJournalIntent['plan']['mappings'],
	graph: FinanceRestoreGraph
) {
	const sources = new Set(
		[...payload.records, ...payload.references, ...payload.attachments].map((row) => row.id)
	)
	const destinations = [
		...mappings.map((row) => row.destinationId),
		graph.member.id,
		graph.source.file.id,
		...graph.parts.map((row) => row.id),
		...graph.source.parts.map((row) => row.id)
	]
	return (
		new Set(destinations).size === destinations.length &&
		!destinations.some((id) => sources.has(id))
	)
}
function draft(
	binding: BackupBinding,
	mappings: RestoreJournalIntent['plan']['mappings'],
	graphHash: string,
	[preparation, financial, activation]: [string, string, string]
): PlanDraft {
	const indexes = mappings.map((row, index) => ({ row, index }))
	const financialIndexes = indexes
		.filter(({ row }) => !(row.kind === 'record' && row.type === 'organizations'))
		.map(({ index }) => index)
	return {
		id: binding.operationId,
		version: 1,
		expectedGraphSha256: graphHash,
		mappings,
		preparation: {
			writeId: 'preparation',
			expectedContentSha256: preparation,
			mappingIndexes: indexes
				.filter(({ row }) => row.kind === 'record' && row.type === 'organizations')
				.map(({ index }) => index)
		},
		batches: financialIndexes.length
			? [
					{
						writeId: 'financial-graph',
						expectedContentSha256: financial,
						mappingIndexes: financialIndexes
					}
				]
			: [],
		activation: { writeId: 'activation', expectedContentSha256: activation },
		requirements: { local: 'notRequired', remote: 'required' }
	}
}
type PlanningInput = { request: FinanceRestorePlanRequest }
type PlanningResult =
	{ outcome: 'planned'; plan: FinanceRestorePlanRequest } | { outcome: 'failed' | 'cancelled' }
type PlanningContext = PlanningInput & {
	binding: BackupBinding
	previous: RestoreJournalIntent | undefined
	source: PrivateValue<Source> | undefined
	decoded: PrivateValue<Decoded> | undefined
	index: IdentityIndex | undefined
	ids: Map<string, string> | undefined
	mappings: RestoreJournalIntent['plan']['mappings'] | undefined
	graph: PrivateValue<FinanceRestoreGraph> | undefined
	graphHash: string | undefined
	draft: PlanDraft | undefined
	planHash: string | undefined
	intent: RestoreJournalIntent | undefined
	result: PlanningResult
}
function buildIntent(input: {
	binding: BackupBinding
	source: PrivateValue<Source>
	graph: PrivateValue<FinanceRestoreGraph>
	draft: PlanDraft
	planHash: string
}) {
	const { payload, payloadSha256 } = input.source.read()
	const intent: RestoreJournalIntent = {
		operation: {
			applicationId: input.binding.applicationId,
			environment: input.binding.environment,
			identityId: input.binding.identityId,
			operationId: input.binding.operationId,
			destinationWorkspaceId: input.graph.read().workspace.id
		},
		archive: {
			archiveId: payload.archiveId,
			payloadSha256,
			profile: payload.profile,
			source: payload.source
		},
		plan: { ...input.draft, sha256: input.planHash }
	}
	createRestoreJournalRecord(intent)
	return intent
}
const events0 = {
	CANCEL:
		types<
			EventPayload<
				{ type: 'CANCEL' | 'SHUTDOWN' } | { type: 'INVALIDATE'; binding: BackupBinding },
				'CANCEL'
			>
		>(),
	SHUTDOWN:
		types<
			EventPayload<
				{ type: 'CANCEL' | 'SHUTDOWN' } | { type: 'INVALIDATE'; binding: BackupBinding },
				'SHUTDOWN'
			>
		>(),
	INVALIDATE:
		types<
			EventPayload<
				{ type: 'CANCEL' | 'SHUTDOWN' } | { type: 'INVALIDATE'; binding: BackupBinding },
				'INVALIDATE'
			>
		>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof actors)['readSource']>
			| import('xstate').OutputFrom<(typeof actors)['decode']>
			| import('xstate').OutputFrom<(typeof actors)['index']>
			| import('xstate').OutputFrom<(typeof actors)['derive']>
			| import('xstate').OutputFrom<(typeof actors)['project']>
			| import('xstate').OutputFrom<(typeof actors)['hashGraph']>
			| import('xstate').OutputFrom<(typeof actors)['hashWrites']>
			| import('xstate').OutputFrom<(typeof actors)['hashPlan']>
			| import('xstate').OutputFrom<(typeof actors)['finish']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent
const actors = {
	readSource: createAsyncLogic<PrivateValue<Source>, PlanningInput>({
		run: ({ input }) =>
			Promise.resolve().then(() => {
				const { archive } = data(input.request)
				const bytes = archive.copyPayloadBytes()
				try {
					return privateValue(input.request, 'financeRestoreSource', {
						payload: archive.readPayload(),
						sourceSize: bytes.byteLength,
						payloadSha256: archive.payloadDigest()
					})
				} finally {
					bytes.fill(0)
				}
			})
	}),
	decode: createAsyncLogic<PrivateValue<Decoded>, PlanningInput & { source: PrivateValue<Source> }>(
		{
			run: ({ input }) =>
				Promise.resolve().then(() =>
					privateValue(
						input.request,
						'financeRestoreRows',
						decodeFinanceBackup(input.source.read().payload)
					)
				)
		}
	),
	index: createAsyncLogic<
		IdentityIndex,
		{ source: PrivateValue<Source>; decoded: PrivateValue<Decoded> }
	>({
		run: ({ input }) =>
			Promise.resolve().then(() => indexIdentities(input.source.read(), input.decoded.read()))
	}),
	derive: createAsyncLogic<Map<string, string>, { operationId: string; names: string[] }>({
		run: ({ input }) =>
			Promise.all(
				input.names.map(
					async (name) =>
						[name, await stableUuid(input.operationId, name)] satisfies [string, string]
				)
			).then((entries) => new Map(entries))
	}),
	project: createAsyncLogic<
		PrivateValue<FinanceRestoreGraph>,
		PlanningInput & {
			source: PrivateValue<Source>
			decoded: PrivateValue<Decoded>
			ids: Map<string, string>
			binding: BackupBinding
		}
	>({
		run: ({ input }) =>
			Promise.resolve().then(() =>
				privateValue(
					input.request,
					'financeRestoreGraph',
					project(input.source.read(), input.decoded.read(), input.ids, input.binding),
					(graph) => {
						for (const part of graph.parts) part.data.fill(0)
					}
				)
			)
	}),
	hashGraph: createAsyncLogic<string, PrivateValue<FinanceRestoreGraph>>({
		run: ({ input }) => digestRecovery(input.read())
	}),
	hashWrites: createAsyncLogic<
		[string, string, string],
		{ graph: PrivateValue<FinanceRestoreGraph>; payloadSha256: string }
	>({
		run: ({ input }) => {
			const graph = input.graph.read()
			return Promise.all([
				digestRecovery([graph.workspace, graph.source, input.payloadSha256]),
				digestRecovery([financeGraphRows(graph), graph.source, input.payloadSha256]),
				digestRecovery(graph.member)
			])
		}
	}),
	hashPlan: createAsyncLogic<string, PlanDraft>({ run: ({ input }) => digestRecovery(input) }),
	finish: createAsyncLogic<RestoreJournalIntent, Parameters<typeof buildIntent>[0]>({
		run: ({ input }) => Promise.resolve().then(() => buildIntent(input))
	})
}
export const financeRestorePlanningMachine = setup({
	schemas: {
		context: types<PlanningContext>(),
		events: events0,
		input: types<PlanningInput>(),
		output: types<PlanningResult>(),
		children: {
			readSource: types<import('xstate').ActorRefFrom<(typeof actors)['readSource']>>(),
			decode: types<import('xstate').ActorRefFrom<(typeof actors)['decode']>>(),
			index: types<import('xstate').ActorRefFrom<(typeof actors)['index']>>(),
			derive: types<import('xstate').ActorRefFrom<(typeof actors)['derive']>>(),
			project: types<import('xstate').ActorRefFrom<(typeof actors)['project']>>(),
			hashGraph: types<import('xstate').ActorRefFrom<(typeof actors)['hashGraph']>>(),
			hashWrites: types<import('xstate').ActorRefFrom<(typeof actors)['hashWrites']>>(),
			hashPlan: types<import('xstate').ActorRefFrom<(typeof actors)['hashPlan']>>(),
			finish: types<import('xstate').ActorRefFrom<(typeof actors)['finish']>>()
		}
	},
	actors,
	guards: {
		sourceScopeMismatch: ({ context }: { context: PlanningContext }, source) =>
			!sourceScopeMatches(context.binding, source.read()),
		savedIntentMismatch: ({ context }: { context: PlanningContext }, source) =>
			!savedIntentMatches(context.binding, context.previous, source.read()),
		savedMappingsMismatch: ({ context }: { context: PlanningContext }, index) =>
			!savedMappingsMatch(context.previous, index),
		hasSavedMappings: ({ context }: { context: PlanningContext }) => context.previous !== undefined,
		identitiesCollide: ({ context }: { context: PlanningContext }, graph) =>
			!identitiesAreUnique(
				required(context.source).read().payload,
				required(context.mappings),
				graph.read()
			),
		rebuiltIntentMismatch: ({ context }: { context: PlanningContext }, intent) =>
			context.previous !== undefined &&
			canonicalRecovery(context.previous) !== canonicalRecovery(intent)
	}
}).createMachine({
	context: ({ input }) => ({
		...input,
		binding: data(input.request).binding,
		previous: data(input.request).previous,
		source: undefined,
		decoded: undefined,
		index: undefined,
		ids: undefined,
		mappings: undefined,
		graph: undefined,
		graphHash: undefined,
		draft: undefined,
		planHash: undefined,
		intent: undefined,
		result: { outcome: 'failed' }
	}),
	initial: 'readingSource',
	output: ({ context }) => context.result,
	on: {
		CANCEL: { target: '.cancelled' },
		SHUTDOWN: { target: '.cancelled' },
		INVALIDATE: (args) => {
			if (!sameBackupBinding(args.context.binding, args.event.binding)) return
			return { target: '.cancelled' }
		}
	},
	states: {
		readingSource: {
			invoke: {
				src: 'readSource',
				input: ({ context }) => ({ request: context.request }),
				onDone: (args) => {
					const { event } = args
					if (args.guards.sourceScopeMismatch(args, event.output)) {
						return { target: 'failed' }
					}
					if (args.guards.savedIntentMismatch(args, event.output)) {
						return { target: 'failed' }
					}
					return { target: 'decoding', context: { source: event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => ({ request: context.request, source: required(context.source) }),
				onDone: (args) => {
					return { target: 'indexing', context: { decoded: args.event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		indexing: {
			invoke: {
				src: 'index',
				input: ({ context }) => ({
					source: required(context.source),
					decoded: required(context.decoded)
				}),
				onDone: (args) => {
					const { event } = args
					if (args.guards.savedMappingsMismatch(args, event.output)) {
						return { target: 'failed' }
					}
					return { target: 'derivingIds', context: { index: event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		derivingIds: {
			invoke: {
				src: 'derive',
				input: ({ context }) => {
					const index = required(context.index)
					return {
						operationId: context.binding.operationId,
						names: [
							...index.physicalNames,
							...(context.previous
								? []
								: index.sources.map((row) => key(row.kind, row.type, row.sourceId)))
						]
					}
				},
				onDone: (args) => {
					const { context, event } = args
					if (args.guards.hasSavedMappings(args)) {
						return {
							target: 'projecting',
							context: {
								ids: new Map([
									...event.output,
									...required(context.previous).plan.mappings.map((row): [string, string] => [
										mappingKey(row),
										row.destinationId
									])
								]),
								mappings: required(context.previous).plan.mappings
							}
						}
					}
					return {
						target: 'projecting',
						context: {
							ids: event.output,
							mappings: newMappings(required(context.index), event.output)
						}
					}
				},
				onError: { target: 'failed' }
			}
		},
		projecting: {
			invoke: {
				src: 'project',
				input: ({ context }) => ({
					request: context.request,
					source: required(context.source),
					decoded: required(context.decoded),
					ids: required(context.ids),
					binding: context.binding
				}),
				onDone: (args) => {
					const { event } = args
					if (args.guards.identitiesCollide(args, event.output)) {
						return { target: 'failed' }
					}
					return { target: 'fingerprintingGraph', context: { graph: event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		fingerprintingGraph: {
			invoke: {
				src: 'hashGraph',
				input: ({ context }) => required(context.graph),
				onDone: (args) => {
					return { target: 'fingerprintingWrites', context: { graphHash: args.event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		fingerprintingWrites: {
			invoke: {
				src: 'hashWrites',
				input: ({ context }) => ({
					graph: required(context.graph),
					payloadSha256: required(context.source).read().payloadSha256
				}),
				onDone: (args) => {
					const { context } = args
					return {
						target: 'fingerprintingPlan',
						context: {
							draft: draft(
								context.binding,
								required(context.mappings),
								required(context.graphHash),
								args.event.output
							)
						}
					}
				},
				onError: { target: 'failed' }
			}
		},
		fingerprintingPlan: {
			invoke: {
				src: 'hashPlan',
				input: ({ context }) => required(context.draft),
				onDone: (args) => {
					return { target: 'validatingIntent', context: { planHash: args.event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		validatingIntent: {
			invoke: {
				src: 'finish',
				input: ({ context }) => ({
					binding: context.binding,
					source: required(context.source),
					graph: required(context.graph),
					draft: required(context.draft),
					planHash: required(context.planHash)
				}),
				onDone: (args) => {
					const { event } = args
					if (args.guards.rebuiltIntentMismatch(args, event.output)) {
						return { target: 'failed' }
					}
					return { target: 'planned', context: { intent: event.output } }
				},
				onError: { target: 'failed' }
			}
		},
		planned: {
			type: 'final',
			entry: (args, enq) => {
				const { context } = args
				enq(({ context }) => {
					data(context.request).plan = {
						graph: required(context.graph).read(),
						intent: required(context.intent)
					}
				}, args)
				return { context: { result: { outcome: 'planned', plan: context.request } } }
			}
		},
		failed: { type: 'final', entry: ({ context }) => context.request.release() },
		cancelled: {
			type: 'final',
			entry: (args, enq) => {
				enq(({ context }) => context.request.release(), args)
				return { context: { result: { outcome: 'cancelled' } } }
			}
		}
	}
})
