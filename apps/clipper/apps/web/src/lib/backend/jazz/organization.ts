import { documentRecord } from './document-record.js'
import { z } from 'zod'
import { tagOperationSchema, tagRequestSchema, tagKey } from '../../capture/tags.js'
import type { TagOperation } from '../../capture/tags.js'
import { createOrganizationDomain } from '../../machines/storage/organization-domain.js'
import type { OrganizationFacts } from '../../machines/storage/organization-domain.js'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import {
	organizationOperationSchema,
	organizationHeads,
	organizationRequestSchema
} from '../../capture/organization.js'
import type { OrganizationOperation } from '../../capture/organization.js'
import {
	createOrganizationMachine,
	type OrganizationDraft
} from '../../machines/storage/organize.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { app } from './schema.js'
import { documentsQuery } from './queries.js'
const tagHistorySchema = z.array(tagOperationSchema)
const organizationHistorySchema = z.array(organizationOperationSchema)
/** Data projection only: observed spelling is reused without renaming the shared tag. */
function tagAssignmentValues(draft: OrganizationDraft, libraryId: string, parents: string[]) {
	const request = tagRequestSchema.parse(draft)
	const known = draft.operations
		.filter((operation) => operation.field === 'tag')
		.sort((a, b) => a.id.localeCompare(b.id))[0]
	return {
		libraryId,
		parents: JSON.stringify(parents),
		key: tagKey(request.value),
		name: known?.name ?? request.value,
		assigned: request.assigned
	}
}
export function createOrganizationRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const readLocal = async (
		resource: TransactionResource,
		input: OrganizationDraft,
		operationId: string
	): Promise<OrganizationFacts> => {
		const request = organizationRequestSchema.parse(input)
		const draft = { ...request, operations: input.operations }
		const document = await resource.tx.one(documentsQuery.where({ id: request.id, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const parents = organizationHeads(
			draft.operations.filter((row) => row.documentId === request.id)
		).map((row) => row.id)
		return { draft, operationId, document, parents }
	}

	const insertTag = (resource: TransactionResource, facts: OrganizationFacts) => {
		resource.tx.insert(
			app.tagOperations,
			{
				documentId: facts.draft.id,
				...tagAssignmentValues(facts.draft, libraryId, facts.parents)
			},
			{ id: facts.operationId }
		)
	}
	const insertOrganization = (resource: TransactionResource, facts: OrganizationFacts) => {
		const document = documentRecord(facts.document, libraryId)
		const change = facts.draft
		if (change.field === 'favorite')
			resource.tx.update(app.libraryDocuments, document.id, { favorite: change.value })
		else if (change.field === 'status')
			resource.tx.update(
				app.libraryDocuments,
				document.id,
				document.status === 'trashed' ? { previousStatus: change.value } : { status: change.value }
			)
		else if (change.field === 'trashed')
			resource.tx.update(
				app.libraryDocuments,
				document.id,
				change.value
					? {
							status: 'trashed',
							previousStatus:
								document.status === 'trashed' ? document.previousStatus : document.status
						}
					: {
							status: document.status === 'trashed' ? document.previousStatus : document.status,
							previousStatus: null
						}
			)
		resource.tx.insert(
			app.organizationOperations,
			{
				libraryId,
				field: facts.draft.field,
				value: String(facts.draft.value),
				parents: JSON.stringify(facts.parents),

				documentId: facts.draft.id
			},
			{ id: facts.operationId }
		)
	}
	const stage = createDomainTransaction<OrganizationDraft>(
		(spawn, input) =>
			spawn(
				createOrganizationDomain({
					read: readLocal,
					insertOrganization,
					insertTag,
					receipt: transactionReceipt
				}),
				{ input }
			),
		transactionLifecycle(db, isCurrent)
	)

	return {
		machine: createOrganizationMachine(
			(spawn, input) => spawn(stage, { input }),
			isCurrent,
			async (request) => {
				const rows = await db.all(
					app.organizationOperations.where({ libraryId, field: request.field }),
					{ tier: ReadTier.LocalFirst }
				)
				return organizationHistorySchema.parse(rows)
			},
			async (request) => {
				const tag = tagRequestSchema.parse(request)
				const rows = await db.all(app.tagOperations.where({ libraryId, key: tagKey(tag.value) }), {
					tier: ReadTier.LocalFirst
				})
				return tagHistorySchema.parse(rows)
			}
		),
		subscribeTags: (next: (rows: TagOperation[]) => void, error: () => void) =>
			db.subscribe(
				app.tagOperations.where({ libraryId }),
				{
					onUpdate: (rows) => {
						const parsed = tagHistorySchema.safeParse(rows)
						if (!parsed.success) {
							error()
							return
						}
						next(parsed.data)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			),
		subscribe: (next: (rows: OrganizationOperation[]) => void, error: () => void) =>
			db.subscribe(
				app.organizationOperations.where({ libraryId }),
				{
					onUpdate: (rows) => {
						const parsed = organizationHistorySchema.safeParse(rows)
						if (!parsed.success) {
							error()
							return
						}
						next(parsed.data)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	}
}
