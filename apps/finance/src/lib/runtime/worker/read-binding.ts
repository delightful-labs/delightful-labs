import { ReadTier, type Db } from 'jazz-tools'
import { app } from '../../schema.js'
import { financeWorkerView } from '../../contracts/worker-application.js'
import type { FinanceReadCapabilities } from '../../contracts/worker-application.js'

/** Inert native construction: no subscription starts until its owning chart invokes it. */
export function createFinanceReadBinding({
	db,
	isCurrent
}: {
	db: Db
	isCurrent: () => boolean
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
					.select('id', 'name', 'kind', 'currency')
					.orderBy('name'),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						const decoded = financeWorkerView.shape.accounts.safeParse(
							rows.map(({ id, name, kind, currency }) => ({ id, name, kind, currency }))
						)
						if (decoded.success) publish(decoded.data)
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			)
	}
}
