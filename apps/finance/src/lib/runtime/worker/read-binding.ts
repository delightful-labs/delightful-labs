import { ReadTier, type Db } from 'jazz-tools'
import { app } from '../../schema.js'
import { workerAccountRecord } from '../../contracts/worker-application.js'
import type { FinanceReadCapabilities } from '../../contracts/worker-application.js'
import { observeRow } from '../observations.js'
import { archiveAccount } from '../../data/accounts.js'

/** Inert native construction: no subscription starts until its owning chart invokes it. */
export function createFinanceReadBinding({
	db,
	isCurrent,
	identityId
}: {
	db: Db
	isCurrent: () => boolean
	identityId: string
}): FinanceReadCapabilities {
	return {
		observeWorkspaces: (publish, failed) =>
			db.subscribe(
				app.organizations.select('id', 'name').orderBy('name'),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						publish(rows.map(({ id, name }) => ({ id, name })))
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
						const decoded = workerAccountRecord.array().safeParse(
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
		archiveAccount: (accountId) => {
			if (!isCurrent()) return Promise.reject(new Error('Finance account binding retired'))
			return archiveAccount(db, accountId)
		}
	}
}
