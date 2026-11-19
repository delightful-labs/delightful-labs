import type { schema as s } from 'jazz-tools'
import { schema } from './schema.js'

const { definePermissions, exists, allowedTo, session, anyOf, allOf, ne, typed, from, outer } =
	schema

const mine = { userId: session.user }

const isOrganizationMemberWithRole = (
	organizationId: s.Uuid,
	role: 'owner' | 'admin' | 'member' | 'viewer'
) => exists.organizationMembers({ organizationId, userId: session.user, role })

const isAdmin = (organizationId: s.Uuid) =>
	anyOf(
		isOrganizationMemberWithRole(organizationId, 'owner'),
		isOrganizationMemberWithRole(organizationId, 'admin')
	)

const canReadMembership = (organizationId: s.Uuid) => anyOf(mine, isAdmin(organizationId))

const hasMembershipScope = (
	organizationId: s.Uuid,
	role: 'owner' | 'admin' | 'member' | 'viewer',
	accountAccessMode: 'all' | 'selected'
) => exists.organizationMembers({ organizationId, userId: session.user, role, accountAccessMode })

const isOrganizationMember = (organizationId: s.Uuid) =>
	exists.organizationMembers({ organizationId, userId: session.user })

const ownsIncompleteRestore = (workspaceId: s.Uuid) =>
	exists.restoreOperations({ workspaceId, ownerId: session.user, status: 'incomplete' })

const canReadAccountOrRestore = (organizationId: s.Uuid, accountId: s.Uuid) =>
	anyOf(
		anyOf(
			isAdmin(organizationId),
			anyOf(
				hasMembershipScope(organizationId, 'member', 'all'),
				hasMembershipScope(organizationId, 'viewer', 'all')
			),
			allOf(
				isOrganizationMember(organizationId),
				exists.accountMemberships({ organizationId, accountId, userId: session.user })
			)
		),
		ownsIncompleteRestore(organizationId)
	)

const canWriteAllAccounts = (organizationId: s.Uuid) =>
	anyOf(
		isOrganizationMemberWithRole(organizationId, 'owner'),
		isOrganizationMemberWithRole(organizationId, 'admin'),
		hasMembershipScope(organizationId, 'member', 'all')
	)

const hasSelectedAccountScope = (organizationId: s.Uuid) =>
	exists.organizationMembers({
		organizationId,
		userId: session.user,
		accountAccessMode: 'selected'
	})

const hasAccountWriteGrant = (organizationId: s.Uuid, accountId: s.Uuid) =>
	exists.accountMemberships({ organizationId, accountId, userId: session.user, access: 'write' })

const canWriteAccount = (organizationId: s.Uuid, accountId: s.Uuid) =>
	anyOf(
		canWriteAllAccounts(organizationId),
		allOf(
			isOrganizationMemberWithRole(organizationId, 'member'),
			hasSelectedAccountScope(organizationId),
			hasAccountWriteGrant(organizationId, accountId)
		)
	)

const canReadWorkspaceOrRestore = (organizationId: s.Uuid) =>
	anyOf(isOrganizationMember(organizationId), ownsIncompleteRestore(organizationId))

const canWriteAllAccountsOrRestore = (organizationId: s.Uuid) =>
	anyOf(canWriteAllAccounts(organizationId), ownsIncompleteRestore(organizationId))

const canEditWorkspaceData = (organizationId: s.Uuid) =>
	anyOf(isAdmin(organizationId), isOrganizationMemberWithRole(organizationId, 'member'))

const activeAccountMatches = (accountId: s.Uuid, organizationId: s.Uuid) =>
	exists.accounts({ id: accountId, organizationId, archivedAt: null })

const accountMatches = (accountId: s.Uuid, organizationId: s.Uuid) =>
	exists.accounts({ id: accountId, organizationId })

const ownedRestoreSource = (sourceFileId: s.Uuid, workspaceId: s.Uuid) =>
	allOf(
		{ transactionId: null, accountId: null },
		exists.restoreOperations({
			sourceFileId,
			workspaceId,
			ownerId: session.user,
			status: 'incomplete'
		})
	)

const canUpdateTransactionFile = (file: s.Row<typeof schema, 'files'>) =>
	allOf(
		{ transactionId: ne(null) },
		allowedTo.update(file.transaction),
		exists.transactions({ id: file.transactionId })
	)

const transactionMatches = (transactionId: s.Uuid, organizationId: s.Uuid) =>
	exists.transactions({ id: transactionId, organizationId })

const transferEndpointsFinancialsMatch = (
	expenseTransactionId: s.Uuid,
	organizationId: s.Uuid,
	accountId: s.Uuid,
	amountMinor: s.Value<'bigint'>,
	currency: s.Value<'string'>,
	internalTransferId: s.Uuid,
	amountMinor2: s.Value<'bigint'>,
	currency2: s.Value<'string'>,
	incomeTransactionId: s.Uuid,
	accountId2: s.Uuid,
	amountMinor3: s.Value<'bigint'>,
	currency3: s.Value<'string'>
) =>
	allOf(
		anyOf(
			exists.transactions({
				id: expenseTransactionId,
				organizationId,
				accountId,
				kind: 'expense',
				amountMinor,
				currency,
				internalTransferId
			}),
			exists.transactions({
				id: expenseTransactionId,
				organizationId,
				accountId,
				kind: 'expense',
				amountMinor: amountMinor2,
				currency: currency2,
				internalTransferId
			})
		),
		anyOf(
			exists.transactions({
				id: incomeTransactionId,
				organizationId,
				accountId: accountId2,
				kind: 'income',
				amountMinor: amountMinor3,
				currency: currency3,
				internalTransferId
			}),
			exists.transactions({
				id: incomeTransactionId,
				organizationId,
				accountId: accountId2,
				kind: 'income',
				amountMinor: amountMinor2,
				currency: currency2,
				internalTransferId
			})
		)
	)

const detachedTransactionMatches = (expenseTransactionId: s.Uuid, organizationId: s.Uuid) =>
	exists.transactions({ id: expenseTransactionId, organizationId, internalTransferId: null })

const linkedEndpointFinancialsMatch = (
	expenseTransactionId: s.Uuid,
	organizationId: s.Uuid,
	accountId: s.Uuid,
	kind: 'expense' | 'income',
	amountMinor: s.Value<'bigint'>,
	currency: s.Value<'string'>,
	kind2: 'expense' | 'income',
	amountMinor2: s.Value<'bigint'>,
	currency2: s.Value<'string'>
) =>
	anyOf(
		exists.transactions({
			id: expenseTransactionId,
			organizationId,
			accountId,
			kind,
			amountMinor,
			currency,
			internalTransferId: ne(null)
		}),
		exists.transactions({
			id: expenseTransactionId,
			organizationId,
			accountId,
			kind: kind2,
			amountMinor: amountMinor2,
			currency: currency2,
			internalTransferId: ne(null)
		})
	)

const detachedEndpointFinancialsMatch = (
	expenseTransactionId: s.Uuid,
	organizationId: s.Uuid,
	accountId: s.Uuid,
	kind: 'expense' | 'income',
	amountMinor: s.Value<'bigint'>,
	currency: s.Value<'string'>,
	kind2: 'expense' | 'income',
	amountMinor2: s.Value<'bigint'>,
	currency2: s.Value<'string'>
) =>
	anyOf(
		exists.transactions({
			id: expenseTransactionId,
			organizationId,
			accountId,
			kind,
			amountMinor,
			currency,
			internalTransferId: null
		}),
		exists.transactions({
			id: expenseTransactionId,
			organizationId,
			accountId,
			kind: kind2,
			amountMinor: amountMinor2,
			currency: currency2,
			internalTransferId: null
		})
	)

const canWriteBothAccounts = (organizationId: s.Uuid, accountId: s.Uuid, accountId2: s.Uuid) =>
	anyOf(
		canWriteAllAccounts(organizationId),
		allOf(
			hasMembershipScope(organizationId, 'member', 'selected'),
			hasAccountWriteGrant(organizationId, accountId),
			hasAccountWriteGrant(organizationId, accountId2)
		)
	)

const transactionMatchesWithKind = (
	expenseTransactionId: s.Uuid,
	organizationId: s.Uuid,
	accountId: s.Uuid,
	kind: 'expense' | 'income',
	internalTransferId: s.Uuid,
	amountMinor: s.Value<'bigint'>,
	currency: s.Value<'string'>
) =>
	exists.transactions({
		id: expenseTransactionId,
		organizationId,
		accountId,
		kind,
		internalTransferId,
		amountMinor,
		currency
	})

const ownerIsMe = { ownerId: session.user }

const workspacePublished = (organizationId: s.Uuid) =>
	anyOf(
		exists.organizations({ id: organizationId, restoreOperationId: null }),
		exists.restoreOperations({ workspaceId: organizationId, status: 'active' })
	)

const canImportProviderTransaction = (
	organizationId: s.Uuid,
	accountId: s.Uuid,
	connectionId: s.Uuid
) =>
	allOf(
		isAdmin(organizationId),
		activeAccountMatches(accountId, organizationId),
		exists.simplefinConnections({ id: connectionId, organizationId, status: 'active' })
	)

const ownsAdminConnection = (organizationId: s.Uuid) => allOf(isAdmin(organizationId), ownerIsMe)

const canAppendSyncAccountResult = (
	simplefinSyncAccountResult: s.Row<typeof schema, 'simplefinSyncAccountResults'>
) =>
	allOf(
		isAdmin(simplefinSyncAccountResult.organizationId),
		allowedTo.update(simplefinSyncAccountResult.attempt),
		exists.simplefinSyncAttempts({
			id: simplefinSyncAccountResult.attemptId,
			organizationId: simplefinSyncAccountResult.organizationId,
			initiatedBy: session.user,
			outcome: 'unfinished'
		}),
		accountMatches(simplefinSyncAccountResult.accountId, simplefinSyncAccountResult.organizationId)
	)

const canStartSyncAttempt = (organizationId: s.Uuid, connectionId: s.Uuid, ownerId: s.Uuid) =>
	allOf(
		isAdmin(organizationId),
		{ initiatedBy: session.user },
		exists.simplefinConnections({ id: connectionId, organizationId, ownerId })
	)

const categoryMatches = (
	categoryId: s.Uuid,
	organizationId: s.Uuid,
	kind: s.Operand<'expense' | 'income', 'enum'>
) => exists.categories({ id: categoryId, organizationId, kind })

const optionalCategoryMatches = (
	categoryId: s.Uuid,
	organizationId: s.Uuid,
	kind: s.Operand<'expense' | 'income', 'enum'>
) => anyOf({ categoryId: null }, categoryMatches(categoryId, organizationId, kind))

const validOptionalCategoryKind = (
	categoryId: s.Uuid,
	organizationId: s.Uuid,
	kind: s.Operand<'expense' | 'income', 'enum'>
) =>
	allOf(
		anyOf({ kind: 'expense' }, { kind: 'income' }),
		optionalCategoryMatches(categoryId, organizationId, kind)
	)

const fileMatches = (fileId: s.Uuid, transactionId: s.Uuid) =>
	exists.files({ id: fileId, transactionId })

const tagMatches = (tagId: s.Uuid, organizationId: s.Uuid) =>
	exists.tags({ id: tagId, organizationId })

const transactionTagTargetsMatch = (
	transactionId: s.Uuid,
	organizationId: s.Uuid,
	kind: 'expense' | 'income',
	tagId: s.Uuid,
	kind2: 'expense' | 'income'
) =>
	allOf(
		exists.transactions({ id: transactionId, organizationId, kind }),
		exists.tags({ id: tagId, organizationId, kind: kind2, archivedAt: null })
	)

const validCheckReference = (checkId: s.Uuid, organizationId: s.Uuid, accountId: s.Uuid) =>
	anyOf(
		allOf(
			{ checkId: null },
			anyOf(
				{ paymentMethod: null },
				{ paymentMethod: 'cash' },
				{ paymentMethod: 'transfer' },
				{ paymentMethod: 'electronic' }
			)
		),
		allOf(
			{ paymentMethod: 'check', checkId: ne(null) },
			exists.checks({ id: checkId, organizationId, accountId })
		)
	)

const transactionWriteReferencesValid = (
	organizationId: s.Uuid,
	accountId: s.Uuid,
	categoryId: s.Uuid,
	kind: s.Operand<'expense' | 'income', 'enum'>,
	currency: s.Value<'string'>,
	checkId: s.Uuid
) =>
	allOf(
		canWriteAccount(organizationId, accountId),
		allOf(
			exists.categories({ id: categoryId, organizationId, kind, archivedAt: null }),
			exists.accounts({ id: accountId, organizationId, currency, archivedAt: null })
		),
		{ checkDetailsId: null },
		validCheckReference(checkId, organizationId, accountId)
	)

const transferReferencesTransaction = (
	internalTransferId: s.Uuid,
	organizationId: s.Uuid,
	expenseTransactionId: s.Uuid,
	expenseAccountId: s.Uuid
) =>
	anyOf(
		exists.internalTransfers({
			id: internalTransferId,
			organizationId,
			expenseTransactionId,
			expenseAccountId
		}),
		exists.internalTransfers({
			id: internalTransferId,
			organizationId,
			incomeTransactionId: expenseTransactionId,
			incomeAccountId: expenseAccountId
		})
	)

export const permissions = definePermissions({
	accountMemberships: {
		read: (accountMembership) => canReadMembership(accountMembership.organizationId),
		insert: (accountMembership) => isAdmin(accountMembership.organizationId),
		update: (accountMembership) => isAdmin(accountMembership.organizationId),
		delete: (accountMembership) => isAdmin(accountMembership.organizationId)
	},
	accounts: {
		read: (account) => canReadAccountOrRestore(account.organizationId, account.id),
		insert: (account) =>
			anyOf(
				allOf(isAdmin(account.organizationId), { archivedAt: null }),
				ownsIncompleteRestore(account.organizationId)
			),
		update: (account) => canWriteAccount(account.organizationId, account.id),
		delete: false
	},
	batchTemplates: {
		read: (batchTemplate) => canReadWorkspaceOrRestore(batchTemplate.organizationId),
		insert: (batchTemplate) => canWriteAllAccountsOrRestore(batchTemplate.organizationId),
		update: (batchTemplate) => canWriteAllAccounts(batchTemplate.organizationId),
		delete: (batchTemplate) => isAdmin(batchTemplate.organizationId)
	},
	categories: {
		read: (category) => canReadWorkspaceOrRestore(category.organizationId),
		insert: (category) =>
			anyOf(
				canEditWorkspaceData(category.organizationId),
				ownsIncompleteRestore(category.organizationId)
			),
		update: (category) => allOf(canEditWorkspaceData(category.organizationId), { isSystem: false }),
		delete: (category) => allOf(isAdmin(category.organizationId), { isSystem: false })
	},
	checkDetails: {
		read: false,
		insert: false,
		update: false,
		delete: false
	},
	checks: {
		read: (check) => canReadAccountOrRestore(check.organizationId, check.accountId),
		insert: (check) =>
			anyOf(
				allOf(
					canWriteAccount(check.organizationId, check.accountId),
					activeAccountMatches(check.accountId, check.organizationId)
				),
				allOf(
					ownsIncompleteRestore(check.organizationId),
					accountMatches(check.accountId, check.organizationId)
				)
			),
		updateIf: (check) => canWriteAccount(check.organizationId, check.accountId),
		updateTo: (check, old) =>
			allOf(
				canWriteAccount(check.organizationId, check.accountId),
				activeAccountMatches(check.accountId, check.organizationId),
				{ organizationId: old.organizationId }
			),
		delete: false
	},
	fileParts: {
		read: (filePart) => allowedTo.read(filePart.file),
		insert: (filePart) => allowedTo.insert(filePart.file),
		update: false,
		delete: (filePart) => allowedTo.delete(filePart.file)
	},
	files: {
		read: (file) =>
			anyOf(
				allOf(
					allowedTo.read(file.transaction),
					exists.transactionAttachments({ fileId: file.id, transactionId: file.transactionId })
				),
				ownedRestoreSource(file.id, file.organizationId),
				allOf(
					{ transactionId: null, accountId: null },
					exists(
						from
							.restoreOperations()
							.join(from.organizationMembers('__join_0'), {
								on: [['restoreOperations.workspaceId', '__join_0.organizationId']]
							})
							.where({
								'restoreOperations.sourceFileId': outer('id'),
								'restoreOperations.workspaceId': outer('organizationId'),
								'restoreOperations.status': typed.text('active'),
								'__join_0.userId': session.user,
								'__join_0.role': [typed.text('owner'), typed.text('admin')]
							})
					)
				)
			),
		insert: (file) =>
			anyOf(
				canUpdateTransactionFile(file),
				ownedRestoreSource(file.id, file.organizationId),
				allOf(
					exists(
						from
							.transactions()
							.join(from.restoreOperations('__join_0'), {
								on: [['transactions.organizationId', '__join_0.workspaceId']]
							})
							.where({
								'transactions.id': outer('transactionId'),
								'__join_0.ownerId': session.user,
								'__join_0.status': typed.text('incomplete')
							})
					),
					anyOf(
						{ organizationId: null },
						transactionMatches(file.transactionId, file.organizationId)
					),
					anyOf({ accountId: null }, file.transaction.where({ accountId: file.accountId }))
				)
			),
		update: false,
		delete: (file) => canUpdateTransactionFile(file)
	},
	internalTransfers: {
		read: (internalTransfer) =>
			allOf(
				allowedTo.read(internalTransfer.expenseTransaction),
				allowedTo.read(internalTransfer.incomeTransaction),
				anyOf(
					transferEndpointsFinancialsMatch(
						internalTransfer.expenseTransactionId,
						internalTransfer.organizationId,
						internalTransfer.expenseAccountId,
						internalTransfer.expenseAmountMinor,
						internalTransfer.expenseCurrency,
						internalTransfer.id,
						internalTransfer.amountMinor,
						internalTransfer.currency,
						internalTransfer.incomeTransactionId,
						internalTransfer.incomeAccountId,
						internalTransfer.incomeAmountMinor,
						internalTransfer.incomeCurrency
					),
					allOf(
						detachedTransactionMatches(
							internalTransfer.expenseTransactionId,
							internalTransfer.organizationId
						),
						detachedTransactionMatches(
							internalTransfer.incomeTransactionId,
							internalTransfer.organizationId
						)
					),
					allOf(
						linkedEndpointFinancialsMatch(
							internalTransfer.expenseTransactionId,
							internalTransfer.organizationId,
							internalTransfer.expenseAccountId,
							'expense',
							internalTransfer.expenseAmountMinor,
							internalTransfer.expenseCurrency,
							'expense',
							internalTransfer.amountMinor,
							internalTransfer.currency
						),
						linkedEndpointFinancialsMatch(
							internalTransfer.incomeTransactionId,
							internalTransfer.organizationId,
							internalTransfer.incomeAccountId,
							'income',
							internalTransfer.incomeAmountMinor,
							internalTransfer.incomeCurrency,
							'income',
							internalTransfer.amountMinor,
							internalTransfer.currency
						)
					)
				)
			),
		insert: (internalTransfer) =>
			anyOf(
				allOf(
					anyOf(
						transferEndpointsFinancialsMatch(
							internalTransfer.expenseTransactionId,
							internalTransfer.organizationId,
							internalTransfer.expenseAccountId,
							internalTransfer.expenseAmountMinor,
							internalTransfer.expenseCurrency,
							internalTransfer.id,
							internalTransfer.amountMinor,
							internalTransfer.currency,
							internalTransfer.incomeTransactionId,
							internalTransfer.incomeAccountId,
							internalTransfer.incomeAmountMinor,
							internalTransfer.incomeCurrency
						),
						allOf(
							detachedEndpointFinancialsMatch(
								internalTransfer.expenseTransactionId,
								internalTransfer.organizationId,
								internalTransfer.expenseAccountId,
								'expense',
								internalTransfer.expenseAmountMinor,
								internalTransfer.expenseCurrency,
								'expense',
								internalTransfer.amountMinor,
								internalTransfer.currency
							),
							detachedEndpointFinancialsMatch(
								internalTransfer.incomeTransactionId,
								internalTransfer.organizationId,
								internalTransfer.incomeAccountId,
								'income',
								internalTransfer.incomeAmountMinor,
								internalTransfer.incomeCurrency,
								'income',
								internalTransfer.amountMinor,
								internalTransfer.currency
							)
						)
					),
					canWriteBothAccounts(
						internalTransfer.organizationId,
						internalTransfer.expenseAccountId,
						internalTransfer.incomeAccountId
					)
				),
				allOf(
					ownsIncompleteRestore(internalTransfer.organizationId),
					anyOf(
						allOf(
							{ expenseAmountMinor: ne(null) },
							{ expenseCurrency: ne(null) },
							transactionMatchesWithKind(
								internalTransfer.expenseTransactionId,
								internalTransfer.organizationId,
								internalTransfer.expenseAccountId,
								'expense',
								internalTransfer.id,
								internalTransfer.expenseAmountMinor,
								internalTransfer.expenseCurrency
							)
						),
						allOf(
							{ expenseAmountMinor: ne(null) },
							{ expenseCurrency: null },
							transactionMatchesWithKind(
								internalTransfer.expenseTransactionId,
								internalTransfer.organizationId,
								internalTransfer.expenseAccountId,
								'expense',
								internalTransfer.id,
								internalTransfer.expenseAmountMinor,
								internalTransfer.currency
							)
						),
						allOf(
							{ expenseAmountMinor: null },
							{ expenseCurrency: ne(null) },
							transactionMatchesWithKind(
								internalTransfer.expenseTransactionId,
								internalTransfer.organizationId,
								internalTransfer.expenseAccountId,
								'expense',
								internalTransfer.id,
								internalTransfer.amountMinor,
								internalTransfer.expenseCurrency
							)
						),
						allOf(
							{ expenseAmountMinor: null },
							{ expenseCurrency: null },
							transactionMatchesWithKind(
								internalTransfer.expenseTransactionId,
								internalTransfer.organizationId,
								internalTransfer.expenseAccountId,
								'expense',
								internalTransfer.id,
								internalTransfer.amountMinor,
								internalTransfer.currency
							)
						)
					),
					anyOf(
						allOf(
							{ incomeAmountMinor: ne(null) },
							{ incomeCurrency: ne(null) },
							transactionMatchesWithKind(
								internalTransfer.incomeTransactionId,
								internalTransfer.organizationId,
								internalTransfer.incomeAccountId,
								'income',
								internalTransfer.id,
								internalTransfer.incomeAmountMinor,
								internalTransfer.incomeCurrency
							)
						),
						allOf(
							{ incomeAmountMinor: ne(null) },
							{ incomeCurrency: null },
							transactionMatchesWithKind(
								internalTransfer.incomeTransactionId,
								internalTransfer.organizationId,
								internalTransfer.incomeAccountId,
								'income',
								internalTransfer.id,
								internalTransfer.incomeAmountMinor,
								internalTransfer.currency
							)
						),
						allOf(
							{ incomeAmountMinor: null },
							{ incomeCurrency: ne(null) },
							transactionMatchesWithKind(
								internalTransfer.incomeTransactionId,
								internalTransfer.organizationId,
								internalTransfer.incomeAccountId,
								'income',
								internalTransfer.id,
								internalTransfer.amountMinor,
								internalTransfer.incomeCurrency
							)
						),
						allOf(
							{ incomeAmountMinor: null },
							{ incomeCurrency: null },
							transactionMatchesWithKind(
								internalTransfer.incomeTransactionId,
								internalTransfer.organizationId,
								internalTransfer.incomeAccountId,
								'income',
								internalTransfer.id,
								internalTransfer.amountMinor,
								internalTransfer.currency
							)
						)
					)
				)
			),
		update: false,
		delete: (internalTransfer) =>
			canWriteBothAccounts(
				internalTransfer.organizationId,
				internalTransfer.expenseAccountId,
				internalTransfer.incomeAccountId
			)
	},
	organizationMembers: {
		read: (organizationMember) => canReadMembership(organizationMember.organizationId),
		insert: (organizationMember) =>
			allOf(
				anyOf(
					isAdmin(organizationMember.organizationId),
					allOf(
						{ userId: session.user, role: 'owner' },
						organizationMember.organization.where(ownerIsMe)
					)
				),
				workspacePublished(organizationMember.organizationId)
			),
		update: (organizationMember) => isAdmin(organizationMember.organizationId),
		delete: (organizationMember) => canReadMembership(organizationMember.organizationId)
	},
	organizations: {
		read: (organization) => isOrganizationMember(organization.id),
		insert: ownerIsMe,
		updateIf: (organization) => isAdmin(organization.id),
		updateTo: (organization, old) =>
			allOf(
				isAdmin(organization.id),
				anyOf(allOf({ restoreOperationId: null }, workspacePublished(organization.id)), {
					restoreOperationId: old.restoreOperationId
				})
			),
		delete: false
	},
	profiles: {
		read: anyOf(
			mine,
			exists(
				from
					.organizationMembers()
					.join(from.organizationMembers('__join_0'), {
						on: [['organizationMembers.organizationId', '__join_0.organizationId']]
					})
					.where({ 'organizationMembers.profileId': outer('id'), '__join_0.userId': session.user })
			)
		),
		insert: mine,
		update: mine,
		delete: false
	},
	restoreOperations: {
		read: (restoreOperation) =>
			anyOf(
				{ ownerId: session.user, status: 'incomplete' },
				allOf(
					{ status: 'active' },
					exists.organizationMembers({
						organizationId: restoreOperation.workspaceId,
						userId: session.user,
						role: ['owner', 'admin']
					})
				)
			),
		insert: (restoreOperation) =>
			allOf(
				{ ownerId: session.user, status: 'incomplete' },
				restoreOperation.workspace.where({
					ownerId: session.user,
					restoreOperationId: restoreOperation.id,
					name: restoreOperation.workspaceName,
					kind: restoreOperation.workspaceKind,
					defaultCurrency: restoreOperation.workspaceCurrency
				})
			),
		updateIf: { ownerId: session.user, status: 'incomplete' },
		updateTo: (restoreOperation) =>
			allOf(
				{ ownerId: session.user, status: 'active' },
				exists.restoreOperations({
					id: restoreOperation.id,
					workspaceId: restoreOperation.workspaceId,
					sourceFileId: restoreOperation.sourceFileId,
					ownerId: restoreOperation.ownerId,
					payloadSha256: restoreOperation.payloadSha256,
					graphSha256: restoreOperation.graphSha256,
					workspaceName: restoreOperation.workspaceName,
					workspaceKind: restoreOperation.workspaceKind,
					workspaceCurrency: restoreOperation.workspaceCurrency,
					status: 'incomplete'
				})
			),
		delete: false
	},
	simplefinAccountLinks: {
		read: (simplefinAccountLink) => isAdmin(simplefinAccountLink.organizationId),
		insert: (simplefinAccountLink) =>
			canImportProviderTransaction(
				simplefinAccountLink.organizationId,
				simplefinAccountLink.accountId,
				simplefinAccountLink.connectionId
			),
		updateIf: (simplefinAccountLink) => isAdmin(simplefinAccountLink.organizationId),
		updateTo: (simplefinAccountLink) =>
			canImportProviderTransaction(
				simplefinAccountLink.organizationId,
				simplefinAccountLink.accountId,
				simplefinAccountLink.connectionId
			),
		delete: (simplefinAccountLink) => isAdmin(simplefinAccountLink.organizationId)
	},
	simplefinConnections: {
		read: (simplefinConnection) => isAdmin(simplefinConnection.organizationId),
		insert: (simplefinConnection) =>
			allOf(ownsAdminConnection(simplefinConnection.organizationId), { accessUrl: '' }),
		updateIf: (simplefinConnection) => ownsAdminConnection(simplefinConnection.organizationId),
		updateTo: (simplefinConnection, old) =>
			allOf(
				ownsAdminConnection(simplefinConnection.organizationId),
				{ accessUrl: '' },
				{ organizationId: old.organizationId, ownerId: old.ownerId }
			),
		delete: (simplefinConnection) => ownsAdminConnection(simplefinConnection.organizationId)
	},
	simplefinSyncAccountResults: {
		read: (simplefinSyncAccountResult) => allowedTo.read(simplefinSyncAccountResult.attempt),
		insert: (simplefinSyncAccountResult) => canAppendSyncAccountResult(simplefinSyncAccountResult),
		updateIf: (simplefinSyncAccountResult) =>
			canAppendSyncAccountResult(simplefinSyncAccountResult),
		updateTo: (simplefinSyncAccountResult, old) =>
			allOf(canAppendSyncAccountResult(simplefinSyncAccountResult), {
				attemptId: old.attemptId,
				organizationId: old.organizationId,
				accountId: old.accountId,
				accountName: old.accountName
			}),
		delete: (simplefinSyncAccountResult) => allowedTo.delete(simplefinSyncAccountResult.attempt)
	},
	simplefinSyncAttempts: {
		read: (simplefinSyncAttempt) => isAdmin(simplefinSyncAttempt.organizationId),
		insert: (simplefinSyncAttempt) =>
			allOf(
				canStartSyncAttempt(
					simplefinSyncAttempt.organizationId,
					simplefinSyncAttempt.connectionId,
					simplefinSyncAttempt.initiatedBy
				),
				{ outcome: 'unfinished', finishedAt: null, importSettlement: 'notStarted' }
			),
		updateIf: (simplefinSyncAttempt) =>
			allOf(
				canStartSyncAttempt(
					simplefinSyncAttempt.organizationId,
					simplefinSyncAttempt.connectionId,
					simplefinSyncAttempt.initiatedBy
				),
				{ outcome: 'unfinished' }
			),
		updateTo: (simplefinSyncAttempt, old) =>
			allOf(
				canStartSyncAttempt(
					simplefinSyncAttempt.organizationId,
					simplefinSyncAttempt.connectionId,
					simplefinSyncAttempt.initiatedBy
				),
				{
					organizationId: old.organizationId,
					connectionId: old.connectionId,
					initiatedBy: old.initiatedBy,
					startedAt: old.startedAt
				}
			),
		delete: (simplefinSyncAttempt) =>
			allOf(
				canStartSyncAttempt(
					simplefinSyncAttempt.organizationId,
					simplefinSyncAttempt.connectionId,
					simplefinSyncAttempt.initiatedBy
				),
				{ outcome: ne('unfinished'), finishedAt: ne(null) }
			)
	},
	tags: {
		read: (tag) => canReadWorkspaceOrRestore(tag.organizationId),
		insert: (tag) =>
			anyOf(
				allOf(
					canEditWorkspaceData(tag.organizationId),
					validOptionalCategoryKind(tag.categoryId, tag.organizationId, tag.kind)
				),
				allOf(
					ownsIncompleteRestore(tag.organizationId),
					optionalCategoryMatches(tag.categoryId, tag.organizationId, tag.kind)
				)
			),
		updateIf: (tag) => canEditWorkspaceData(tag.organizationId),
		updateTo: (tag, old) =>
			allOf(
				canEditWorkspaceData(tag.organizationId),
				validOptionalCategoryKind(tag.categoryId, tag.organizationId, tag.kind),
				{
					organizationId: old.organizationId,
					kind: old.kind
				}
			),
		delete: (tag) => isAdmin(tag.organizationId)
	},
	transactionAttachments: {
		read: (transactionAttachment) => allowedTo.read(transactionAttachment.transaction),
		insert: (transactionAttachment) =>
			anyOf(
				allowedTo.update(transactionAttachment.transaction),
				allOf(
					allowedTo.insert(transactionAttachment.file),
					fileMatches(transactionAttachment.fileId, transactionAttachment.transactionId)
				)
			),
		updateIf: (transactionAttachment) => allowedTo.update(transactionAttachment.transaction),
		updateTo: (transactionAttachment) =>
			allOf(
				allowedTo.update(transactionAttachment.transaction),
				fileMatches(transactionAttachment.fileId, transactionAttachment.transactionId)
			),
		delete: (transactionAttachment) => allowedTo.update(transactionAttachment.transaction)
	},
	transactionBatches: {
		read: (transactionBatch) => canReadWorkspaceOrRestore(transactionBatch.organizationId),
		insert: (transactionBatch) => canWriteAllAccountsOrRestore(transactionBatch.organizationId),
		update: (transactionBatch) => canWriteAllAccounts(transactionBatch.organizationId),
		delete: (transactionBatch) => isAdmin(transactionBatch.organizationId)
	},
	transactionTags: {
		read: (transactionTag) =>
			allOf(
				allowedTo.read(transactionTag.transaction),
				transactionMatches(transactionTag.transactionId, transactionTag.organizationId),
				tagMatches(transactionTag.tagId, transactionTag.organizationId)
			),
		insert: (transactionTag) =>
			anyOf(
				allOf(
					allowedTo.update(transactionTag.transaction),
					anyOf(
						transactionTagTargetsMatch(
							transactionTag.transactionId,
							transactionTag.organizationId,
							'expense',
							transactionTag.tagId,
							'expense'
						),
						transactionTagTargetsMatch(
							transactionTag.transactionId,
							transactionTag.organizationId,
							'income',
							transactionTag.tagId,
							'income'
						)
					)
				),
				allOf(
					ownsIncompleteRestore(transactionTag.organizationId),
					transactionMatches(transactionTag.transactionId, transactionTag.organizationId),
					tagMatches(transactionTag.tagId, transactionTag.organizationId)
				)
			),
		delete: (transactionTag) =>
			allOf(
				allowedTo.update(transactionTag.transaction),
				transactionMatches(transactionTag.transactionId, transactionTag.organizationId),
				tagMatches(transactionTag.tagId, transactionTag.organizationId)
			)
	},
	transactions: {
		read: (transaction) =>
			canReadAccountOrRestore(transaction.organizationId, transaction.accountId),
		insert: (transaction) =>
			anyOf(
				allOf(
					transactionWriteReferencesValid(
						transaction.organizationId,
						transaction.accountId,
						transaction.categoryId,
						transaction.kind,
						transaction.currency,
						transaction.checkId
					),
					anyOf(
						{ internalTransferId: null },
						{ source: 'manual' },
						transferReferencesTransaction(
							transaction.internalTransferId,
							transaction.organizationId,
							transaction.id,
							transaction.accountId
						)
					)
				),
				allOf(
					ownsIncompleteRestore(transaction.organizationId),
					{ checkDetailsId: null },
					transaction.account.where({
						organizationId: transaction.organizationId,
						currency: transaction.currency
					}),
					categoryMatches(transaction.categoryId, transaction.organizationId, transaction.kind),
					validCheckReference(
						transaction.checkId,
						transaction.organizationId,
						transaction.accountId
					)
				)
			),
		updateIf: (transaction) => canWriteAccount(transaction.organizationId, transaction.accountId),
		updateTo: (transaction, old) =>
			allOf(
				transactionWriteReferencesValid(
					transaction.organizationId,
					transaction.accountId,
					transaction.categoryId,
					transaction.kind,
					transaction.currency,
					transaction.checkId
				),
				anyOf(
					allOf(
						{ internalTransferId: null },
						anyOf(
							exists.transactions({ id: transaction.id, internalTransferId: null }),
							allOf(exists.transactions({ id: transaction.id, internalTransferId: ne(null) }), {
								organizationId: old.organizationId,
								accountId: old.accountId,
								kind: old.kind,
								amountMinor: old.amountMinor,
								currency: old.currency
							})
						)
					),
					allOf(
						transferReferencesTransaction(
							transaction.internalTransferId,
							transaction.organizationId,
							transaction.id,
							transaction.accountId
						),
						{
							organizationId: old.organizationId,
							accountId: old.accountId,
							kind: old.kind,
							amountMinor: old.amountMinor,
							currency: old.currency
						}
					)
				),
				{ organizationId: old.organizationId, kind: old.kind, source: old.source },
				anyOf(
					allOf(
						{ externalId: null },
						exists.transactions({ id: transaction.id, externalId: null })
					),
					{ externalId: old.externalId }
				)
			),
		delete: (transaction) =>
			allOf(
				anyOf(
					isAdmin(transaction.organizationId),
					allOf(
						isOrganizationMemberWithRole(transaction.organizationId, 'member'),
						hasSelectedAccountScope(transaction.organizationId),
						exists.accountMemberships({
							organizationId: transaction.organizationId,
							accountId: transaction.accountId,
							userId: session.user,
							canDelete: true
						})
					)
				),
				{ internalTransferId: null }
			)
	},
	uploads: {
		read: false,
		insert: false,
		update: false,
		delete: false
	}
})
