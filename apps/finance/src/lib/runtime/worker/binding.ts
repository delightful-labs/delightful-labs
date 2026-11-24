import { workerTransferRecord } from '../../contracts/worker-transfers.js'
import { createAccountDeleteGrantMachine } from '../../machines/accounts/account-delete-grants.js'
import { workerWorkspaceMember, workerAccountGrant } from '../../contracts/worker-accounts.js'
import { windowBackupHandoff } from './download.js'
import { createWorkspaceBackupMachine } from '../../machines/workspaces/workspace-backup.js'
import {
	createWorkspaceRestoreController,
	prepareWorkspaceRestoreFile,
	bindWorkspaceRestoreResource
} from '../../machines/workspaces/workspace-restore.js'
import { createProfileFormOptions } from '../../machines/identity/profile.js'
import { createWorkspaceRenameFormOptions } from '../../machines/workspaces/workspace-rename.js'
import { saveProfileName, saveProfileAvatar, workspaceNamingWrites } from '../../data.js'
import {
	createCategoryManagementFormOptions,
	createTagManagementFormOptions
} from '../../machines/management/classification-forms.js'
import {
	createCategory,
	archiveCategory,
	createTag,
	archiveTag
} from '../../data/classification.js'
import { createWorkspaceNavigationMachine } from '../../machines/workspaces/workspace-navigation.js'
import type {
	RecoveryScope,
	RecoveryScopeSource,
	RecoveryPhraseCapability
} from 'delightful-local-first/recovery/contracts'
import { ReadTier, type Db } from 'jazz-tools'
import { app } from '../../queries.js'
import {
	workerWorkspace,
	workerProfile,
	workerWorkspaceSettings,
	type FinanceWorkerCapabilities
} from '../../contracts/worker-application.js'
import { observeRow, observeRows } from '../observations.js'
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
	binding,
	recovery
}: {
	db: Db
	isCurrent: () => boolean
	identityId: string
	binding: object
	recovery: { source: RecoveryScopeSource; capability: RecoveryPhraseCapability }
}): FinanceWorkerCapabilities {
	const capabilities: FinanceWorkerCapabilities = {
		prepareWorkspaceRestore: (file, password) => {
			if (!isCurrent()) throw new Error('Finance restoration binding retired')
			const config = db.getConfig()
			if (!config.serverUrl) throw new Error('Finance restoration configuration unavailable')
			const request = prepareWorkspaceRestoreFile(file, password)
			try {
				bindWorkspaceRestoreResource(
					request,
					{
						identityId,
						db,
						isCurrent,
						subscribe: (notify) => recovery.source.subscribe(() => notify())
					},
					{
						appId: config.scope || config.serverUrl.replace(/\/+$/, ''),
						serverUrl: config.serverUrl,
						environment: config.env ?? 'finance'
					}
				)
				return request
			} catch (error) {
				request.release()
				throw error
			}
		},
		observeTransfers: (workspaceId, publish, failed) =>
			db.subscribe(
				app.internalTransfers.where({ organizationId: workspaceId }),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						publish(
							workerTransferRecord.array().parse(
								rows.map((row) => ({
									id: row.id,
									organizationId: row.organizationId,
									expenseTransactionId: row.expenseTransactionId,
									incomeTransactionId: row.incomeTransactionId,
									expenseAccountId: row.expenseAccountId ?? null,
									incomeAccountId: row.incomeAccountId ?? null,
									expenseAmountMinor: row.expenseAmountMinor ?? null,
									incomeAmountMinor: row.incomeAmountMinor ?? null,
									expenseCurrency: row.expenseCurrency ?? null,
									incomeCurrency: row.incomeCurrency ?? null,
									amountMinor: row.amountMinor ?? null,
									currency: row.currency ?? null
								}))
							)
						)
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeWorkspaceMembers: (workspaceId, publish, failed) =>
			db.subscribe(
				app.organizationMembers.where({ organizationId: workspaceId }),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						publish(
							workerWorkspaceMember.array().parse(
								rows.map((row) => ({
									id: row.id,
									organizationId: row.organizationId,
									userId: row.userId,
									profileId: row.profileId,
									role: row.role,
									accountAccessMode: row.accountAccessMode
								}))
							)
						)
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeAccountGrants: (workspaceId, publish, failed) =>
			db.subscribe(
				app.accountMemberships.where({ organizationId: workspaceId }),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						publish(
							workerAccountGrant.array().parse(
								rows.map((row) => ({
									id: row.id,
									organizationId: row.organizationId,
									userId: row.userId,
									accountId: row.accountId,
									access: row.access,
									canDelete: row.canDelete
								}))
							)
						)
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeBankConnections: (organizationId, publish, failed) =>
			db.subscribe(
				app.simplefinConnections
					.where({ organizationId })
					.orderBy('claimedAt', 'desc')
					.orderBy('id', 'desc'),
				{
					onUpdate: (rows) => {
						if (isCurrent()) publish(observeRows(rows))
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeBankLinks: (organizationId, publish, failed) =>
			db.subscribe(
				app.simplefinAccountLinks.where({ organizationId }),
				{
					onUpdate: (rows) => {
						if (isCurrent()) publish(observeRows(rows))
						else failed()
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeProfile: (publish, failed) =>
			db.subscribe(
				app.profiles.where({ userId: identityId }),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						const row = rows[0]
						publish(
							row
								? workerProfile.parse({
										id: row.id,
										userId: row.userId,
										displayName: row.displayName,
										avatarData: row.avatarData,
										avatarMimeType: row.avatarMimeType
									})
								: null
						)
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
		observeWorkspace: (workspaceId, publish, failed) =>
			db.subscribe(
				app.organizations.where({ id: workspaceId }),
				{
					onUpdate: (rows) => {
						if (!isCurrent()) {
							failed()
							return
						}
						const row = rows[0]
						publish(
							row
								? workerWorkspaceSettings.parse({
										id: row.id,
										name: row.name,
										kind: row.kind,
										defaultCurrency: row.defaultCurrency,
										ownerId: row.ownerId
									})
								: null
						)
					},
					onError: failed
				},
				{ tier: ReadTier.LocalFirst }
			),
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
					.where({ organizationId: workspaceId })
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
						'memo',
						'internalTransferId'
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
									internalTransferId,
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
									internalTransferId: internalTransferId ?? null,
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
		readRecoveryPhrase: async () => {
			if (!isCurrent()) throw new Error('Finance recovery binding retired')
			// The native source publishes its current scope synchronously. Observe once;
			// the shared SDK capability rechecks the exact binding adjacent to export.
			const observed: { scope: RecoveryScope } = { scope: { kind: 'unavailable' } }
			const stop = recovery.source.subscribe((scope) => {
				observed.scope = scope
			})
			stop()
			if (observed.scope.kind !== 'available') throw new Error('Recovery unavailable')
			const phrase = await recovery.capability.readPhrase(observed.scope)
			if (!isCurrent() || !recovery.capability.isCurrentScope(observed.scope))
				throw new Error('Recovery binding changed')
			return phrase
		},
		archiveAccount: (accountId) => {
			if (!isCurrent()) return Promise.reject(new Error('Finance account binding retired'))
			return archiveAccount(db, accountId)
		},
		createForms: (
			observe,
			archive,
			navigate,
			accountOrderStorage,
			transferDispatch,
			routeObserved,
			contentObserved,
			reportDisposalFailure
		) =>
			createFinanceFormsMachine({
				content: capabilities,
				contentObserved,
				reportDisposalFailure,
				transferDispatch,
				binding,
				db,
				initialization: { db, userId: identityId },
				accountOrderStorage,
				creationKey: JSON.stringify([db.getConfig().env ?? 'finance', identityId]),
				navigate: routeObserved
					? (destination, signal) => {
							const route = observe().navigation
							return navigate(
								destination,
								signal,
								`${route.pathname}${route.search}${route.hash}`,
								true
							)
						}
					: undefined,
				accountAccess: createAccountDeleteGrantMachine(
					(write) => {
						if (!isCurrent())
							return Promise.reject(new Error('Finance account access binding retired'))
						return write.kind === 'update'
							? db
									.update(app.accountMemberships, write.grantId, { canDelete: write.canDelete })
									.wait({ tier: 'local' })
							: db
									.insert(app.accountMemberships, {
										organizationId: write.organizationId,
										accountId: write.accountId,
										userId: write.userId,
										access: 'read',
										canDelete: write.canDelete
									})
									.wait({ tier: 'local' })
					},
					() => observe().accountAccess
				),
				reload: () => globalThis.postMessage({ type: 'RELOAD_PAGE' }),
				backup: createWorkspaceBackupMachine({
					db,
					observe: () => observe().backup,
					environment: db.getConfig().env ?? 'finance',
					handoff: windowBackupHandoff
				}),
				restore: createWorkspaceRestoreController((destination) => {
					const route = observe().navigation
					return navigate(
						destination,
						new AbortController().signal,
						`${route.pathname}${route.search}${route.hash}`,
						false
					)
				}),
				profile: createProfileFormOptions({
					binding,
					observe: () => observe().profile,
					saveName: (id, user, name) => saveProfileName(db, id, user, name),
					saveAvatar: (id, user, values) => saveProfileAvatar(db, id, user, values)
				}),
				workspace: createWorkspaceRenameFormOptions({
					binding,
					observe: () => observe().workspace,
					...workspaceNamingWrites(db)
				}),
				classification: {
					categories: createCategoryManagementFormOptions({
						binding,
						observe: () => observe().classification,
						create: async (organizationId, values) => {
							if (!isCurrent()) throw new Error('Finance classification binding retired')
							const row = await createCategory(db, organizationId, values.name, values.kind)
							return workerTransactionCategory.parse({
								id: row.id,
								organizationId: row.organizationId,
								name: row.name,
								kind: row.kind,
								isSystem: row.isSystem,
								archivedAt: row.archivedAt ?? null
							})
						},
						archive: (id) =>
							isCurrent()
								? archiveCategory(db, id)
								: Promise.reject(new Error('Finance classification binding retired'))
					}),
					tags: createTagManagementFormOptions({
						binding,
						observe: () => observe().classification,
						create: async (organizationId, values) => {
							if (!isCurrent()) throw new Error('Finance classification binding retired')
							const row = await createTag(
								db,
								organizationId,
								values.name,
								values.kind,
								values.categoryId
							)
							return workerTagRecord.parse({
								id: row.id,
								organizationId: row.organizationId,
								name: row.name,
								kind: row.kind,
								categoryId: row.categoryId ?? null,
								archivedAt: row.archivedAt ?? null
							})
						},
						archive: (id) =>
							isCurrent()
								? archiveTag(db, id)
								: Promise.reject(new Error('Finance classification binding retired'))
					})
				},
				navigation: createWorkspaceNavigationMachine(db, (destination, signal, origin, replace) => {
					if (!isCurrent()) return Promise.reject(new Error('Finance navigation binding retired'))
					return navigate(destination, signal, origin, replace)
				}),
				archive,
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
	return capabilities
}
