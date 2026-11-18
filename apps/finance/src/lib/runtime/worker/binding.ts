import { ReadTier, type Db } from 'jazz-tools'
import { app } from '../../schema.js'
import {
	workerWorkspace,
	type FinanceWorkerCapabilities
} from '../../contracts/worker-application.js'
import { observeRow } from '../observations.js'
import { archiveAccount, createAccount } from '../../data/accounts.js'
import { transactionTagNames } from '../../domain/transaction-tags.js'
import { transactionLedgerRecordSchema } from '../../validation/transactions.js'
import { persistedAccountSchema } from '../../validation/accounts.js'
import { workerTransactionCategory, workerTagRecord } from '../../contracts/worker-forms.js'
import { createFinanceFormsMachine } from '../../machines/runtime/worker-forms.js'

/** Inert native construction: no subscription starts until its owning chart invokes it. */
export function createFinanceWorkerBinding({
	db,
	isCurrent,
	identityId,
	binding
}: {
	db: Db
	isCurrent: () => boolean
	identityId: string
	binding: object
}): FinanceWorkerCapabilities {
	return {
		observeWorkspaces: (publish, failed) =>
			db.subscribe(
				app.organizations.select('id', 'name', 'defaultCurrency').orderBy('name'),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						publish(
							workerWorkspace.array().parse(
								rows.map(({ id, name, defaultCurrency }) => ({
									id,
									name,
									defaultCurrency: defaultCurrency === 'TZS' ? 'TZS' : 'USD'
								}))
							)
						)
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeAccounts: (workspaceId, publish, failed) =>
			db.subscribe(
				app.accounts
					.where({ organizationId: workspaceId, archivedAt: { isNull: true } })
					.select('id', 'organizationId', 'name', 'kind', 'currency', 'archivedAt')
					.orderBy('name'),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						const decoded = persistedAccountSchema.array().safeParse(
							rows.map(({ id, organizationId, name, kind, currency, archivedAt }) => ({
								id,
								organizationId,
								name,
								kind,
								currency,
								archivedAt
							}))
						)
						if (decoded.success) publish(decoded.data)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeMembership: (workspaceId, publish, failed) =>
			db.subscribe(
				app.organizationMembers.where({ organizationId: workspaceId, userId: identityId }),
				{
					onUpdate: (rows) => {
						if (isCurrent()) publish(observeRow(rows[0]) ?? null)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeGrants: (workspaceId, publish, failed) =>
			db.subscribe(
				app.accountMemberships
					.where({ organizationId: workspaceId, userId: identityId })
					.select('organizationId', 'userId', 'accountId', 'access'),
				{
					onUpdate: (rows) => {
						if (isCurrent())
							publish(
								rows.map(({ organizationId, userId, accountId, access }) => ({
									organizationId,
									userId,
									accountId,
									access
								}))
							)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeCategories: (workspaceId, publish, failed) =>
			db.subscribe(
				app.categories.where({ organizationId: workspaceId }).orderBy('name'),
				{
					onUpdate: (rows) => {
						const decoded = workerTransactionCategory.array().safeParse(
							rows.map(({ id, organizationId, name, kind, isSystem, archivedAt }) => ({
								id,
								organizationId,
								name,
								kind,
								isSystem,
								archivedAt
							}))
						)
						if (isCurrent() && decoded.success) publish(decoded.data)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeTags: (workspaceId, publish, failed) =>
			db.subscribe(
				app.tags.where({ organizationId: workspaceId }).orderBy('name'),
				{
					onUpdate: (rows) => {
						const decoded = workerTagRecord.array().safeParse(
							rows.map(({ id, organizationId, name, kind, categoryId, archivedAt }) => ({
								id,
								organizationId,
								name,
								kind,
								categoryId,
								archivedAt
							}))
						)
						if (isCurrent() && decoded.success) publish(decoded.data)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeTransactions: (workspaceId, publish, failed) =>
			db.subscribe(
				app.transactions
					.where({ organizationId: workspaceId })
					.select(
						'id',
						'organizationId',
						'accountId',
						'categoryId',
						'amountMinor',
						'currency',
						'kind',
						'bookedOn',
						'description',
						'memo'
					)
					.include({ tags: { tag: true } })
					.orderBy('bookedOn', 'desc'),
				{
					onUpdate: (rows) => {
						const decoded = transactionLedgerRecordSchema.array().safeParse(
							rows.map(
								({
									id,
									organizationId,
									accountId,
									categoryId,
									amountMinor,
									currency,
									kind,
									bookedOn,
									description,
									memo,
									tags
								}) => ({
									id,
									organizationId,
									accountId,
									categoryId,
									amountMinor,
									currency,
									kind,
									bookedOn,
									description,
									memo,
									tagNames:
										transactionTagNames(
											tags.flatMap((link) => (link.tag ? [link.tag] : [])),
											tags
										).get(id) ?? []
								})
							)
						)
						if (isCurrent() && decoded.success) publish(decoded.data)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeTransaction: (organizationId, id, publish, failed) =>
			db.subscribe(
				app.transactions
					.where({ organizationId, id })
					.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt')
					.include({
						account: true,
						category: true,
						tags: { tag: true },
						check: true,
						attachments: true
					}),
				{
					onUpdate: (rows) => {
						if (isCurrent()) publish(observeRow(rows[0]) ?? null)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		archiveAccount: (accountId) => {
			if (!isCurrent()) return Promise.reject(new Error('Finance account binding retired'))
			return archiveAccount(db, accountId)
		},
		createForms: (observe) =>
			createFinanceFormsMachine({
				binding,
				db,
				observe,
				create: async (workspaceId, values) => {
					if (!isCurrent()) throw new Error('Finance account binding retired')
					const row = await createAccount(
						db,
						workspaceId,
						values.name,
						values.kind,
						values.currency
					)
					return persistedAccountSchema.parse({
						id: row.id,
						organizationId: row.organizationId,
						name: row.name,
						kind: row.kind,
						currency: row.currency,
						archivedAt: row.archivedAt
					})
				}
			})
	}
}
