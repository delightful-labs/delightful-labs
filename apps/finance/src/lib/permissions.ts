import { ACCOUNT_ACCESS } from '#lib/domain/account-access.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
import { TRANSACTION_SOURCE } from '#lib/domain/transaction-source.js'
import { schema as s } from 'jazz-tools'
import { type RowContext, type RowRefValue } from 'jazz-tools/permissions'
import {
	app,
	previousApp,
	type InternalTransfer,
	type OrganizationMember,
	type SyncAttempt,
	type SyncAccountResult,
	type Tag,
	type TransactionRow
} from './schema.js'
import { checkReferenceCondition } from './authorization/check-reference-permissions.js'

type Role = NonNullable<OrganizationMember['role']>
type IdExpression = string | RowRefValue
type TransactionContext = Pick<
	RowContext<TransactionRow>,
	| 'id'
	| 'accountId'
	| 'categoryId'
	| 'organizationId'
	| 'amountMinor'
	| 'currency'
	| 'kind'
	| 'paymentMethod'
	| 'checkDetailsId'
	| 'checkId'
	| 'internalTransferId'
>
type InternalTransferContext = Pick<
	RowContext<InternalTransfer>,
	| 'id'
	| 'organizationId'
	| 'expenseTransactionId'
	| 'incomeTransactionId'
	| 'expenseAccountId'
	| 'incomeAccountId'
	| 'expenseAmountMinor'
	| 'expenseCurrency'
	| 'incomeAmountMinor'
	| 'incomeCurrency'
	| 'amountMinor'
	| 'currency'
>

const normal = s.definePermissions(previousApp, (bindings) => {
	const { policy, session, anyOf, allOf, allowedTo } = bindings
	const isMember = (organizationId: IdExpression) =>
		policy.organizationMembers.exists.where({ organizationId, userId: session.user })

	const hasRole = (organizationId: IdExpression, role: Role) =>
		policy.organizationMembers.exists.where({
			organizationId,
			userId: session.user,
			role
		})

	const isAdmin = (organizationId: IdExpression) =>
		anyOf([
			hasRole(organizationId, ORGANIZATION_ROLE.OWNER),
			hasRole(organizationId, ORGANIZATION_ROLE.ADMIN)
		])

	const canReadAllAccounts = (organizationId: IdExpression) =>
		anyOf([
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user,
				role: ORGANIZATION_ROLE.MEMBER,
				accountAccessMode: ACCOUNT_ACCESS.ALL
			}),
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user,
				role: ORGANIZATION_ROLE.VIEWER,
				accountAccessMode: ACCOUNT_ACCESS.ALL
			})
		])

	const canWriteAllAccounts = (organizationId: IdExpression) =>
		anyOf([
			hasRole(organizationId, ORGANIZATION_ROLE.OWNER),
			hasRole(organizationId, ORGANIZATION_ROLE.ADMIN),
			policy.organizationMembers.exists.where({
				organizationId,
				userId: session.user,
				role: ORGANIZATION_ROLE.MEMBER,
				accountAccessMode: ACCOUNT_ACCESS.ALL
			})
		])

	const canReadAccount = (accountId: IdExpression, organizationId: IdExpression) =>
		anyOf([
			isAdmin(organizationId),
			canReadAllAccounts(organizationId),
			allOf([
				isMember(organizationId),
				policy.accountMemberships.exists.where({
					organizationId,
					accountId,
					userId: session.user
				})
			])
		])

	const canWriteAccount = (accountId: IdExpression, organizationId: IdExpression) =>
		anyOf([
			canWriteAllAccounts(organizationId),
			allOf([
				hasRole(organizationId, ORGANIZATION_ROLE.MEMBER),
				policy.organizationMembers.exists.where({
					organizationId,
					userId: session.user,
					accountAccessMode: ACCOUNT_ACCESS.SELECTED
				}),
				policy.accountMemberships.exists.where({
					organizationId,
					accountId,
					userId: session.user,
					access: 'write'
				})
			])
		])

	const canDeleteAccount = (accountId: IdExpression, organizationId: IdExpression) =>
		anyOf([
			isAdmin(organizationId),
			allOf([
				hasRole(organizationId, ORGANIZATION_ROLE.MEMBER),
				policy.organizationMembers.exists.where({
					organizationId,
					userId: session.user,
					accountAccessMode: ACCOUNT_ACCESS.SELECTED
				}),
				policy.accountMemberships.exists.where({
					organizationId,
					accountId,
					userId: session.user,
					canDelete: true
				})
			])
		])

	const canWriteTransferAccounts = (transfer: InternalTransferContext) =>
		anyOf([
			canWriteAllAccounts(transfer.organizationId),
			allOf([
				policy.organizationMembers.exists.where({
					organizationId: transfer.organizationId,
					userId: session.user,
					role: ORGANIZATION_ROLE.MEMBER,
					accountAccessMode: ACCOUNT_ACCESS.SELECTED
				}),
				policy.accountMemberships.exists.where({
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					userId: session.user,
					access: 'write'
				}),
				policy.accountMemberships.exists.where({
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					userId: session.user,
					access: 'write'
				})
			])
		])

	const transactionReferencesAreValid = (transaction: TransactionContext) =>
		allOf([
			policy.categories.exists.where({
				id: transaction.categoryId,
				organizationId: transaction.organizationId,
				kind: transaction.kind,
				archivedAt: { isNull: true }
			}),
			policy.accounts.exists.where({
				id: transaction.accountId,
				organizationId: transaction.organizationId,
				currency: transaction.currency,
				archivedAt: { isNull: true }
			})
		])

	const canWriteTransaction = (transaction: TransactionContext) =>
		allOf([
			canWriteAccount(transaction.accountId, transaction.organizationId),
			transactionReferencesAreValid(transaction),
			{ checkDetailsId: { isNull: true } },
			checkReferenceCondition({
				transaction,
				checkExists: (where) => policy.checks.exists.where(where)
			})
		])

	const transferEndpointFactsMatch = (
		transfer: InternalTransferContext,
		marker: RowRefValue | { isNull: true } = transfer.id
	) =>
		allOf([
			anyOf([
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.expenseAmountMinor,
					currency: transfer.expenseCurrency,
					internalTransferId: marker
				}),
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: marker
				})
			]),
			anyOf([
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.incomeAmountMinor,
					currency: transfer.incomeCurrency,
					internalTransferId: marker
				}),
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: marker
				})
			])
		])

	const transferEndpointsAreUnlinked = (transfer: InternalTransferContext) =>
		allOf([
			policy.transactions.exists.where({
				id: transfer.expenseTransactionId,
				organizationId: transfer.organizationId,
				internalTransferId: { isNull: true }
			}),
			policy.transactions.exists.where({
				id: transfer.incomeTransactionId,
				organizationId: transfer.organizationId,
				internalTransferId: { isNull: true }
			})
		])

	const transferEndpointsHaveMarkers = (transfer: InternalTransferContext) =>
		allOf([
			anyOf([
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.expenseAmountMinor,
					currency: transfer.expenseCurrency,
					internalTransferId: { isNull: false }
				}),
				policy.transactions.exists.where({
					id: transfer.expenseTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.expenseAccountId,
					kind: EXPENSE,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: { isNull: false }
				})
			]),
			anyOf([
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.incomeAmountMinor,
					currency: transfer.incomeCurrency,
					internalTransferId: { isNull: false }
				}),
				policy.transactions.exists.where({
					id: transfer.incomeTransactionId,
					organizationId: transfer.organizationId,
					accountId: transfer.incomeAccountId,
					kind: INCOME,
					amountMinor: transfer.amountMinor,
					currency: transfer.currency,
					internalTransferId: { isNull: false }
				})
			])
		])

	const transactionTransferRelationshipExists = (transaction: TransactionContext) =>
		anyOf([
			policy.internalTransfers.exists.where({
				id: transaction.internalTransferId,
				organizationId: transaction.organizationId,
				expenseTransactionId: transaction.id,
				expenseAccountId: transaction.accountId
			}),
			policy.internalTransfers.exists.where({
				id: transaction.internalTransferId,
				organizationId: transaction.organizationId,
				incomeTransactionId: transaction.id,
				incomeAccountId: transaction.accountId
			})
		])

	const transactionFinancialFactsAreUnchanged = (transaction: TransactionContext) =>
		policy.transactions.exists.where({
			id: transaction.id,
			organizationId: transaction.organizationId,
			accountId: transaction.accountId,
			kind: transaction.kind,
			amountMinor: transaction.amountMinor,
			currency: transaction.currency
		})

	const transactionTransferUpdateIsValid = (transaction: TransactionContext) =>
		anyOf([
			allOf([
				transactionHasNoTransfer(),
				anyOf([
					policy.transactions.exists.where({
						id: transaction.id,
						internalTransferId: { isNull: true }
					}),
					allOf([
						policy.transactions.exists.where({
							id: transaction.id,
							internalTransferId: { isNull: false }
						}),
						transactionFinancialFactsAreUnchanged(transaction)
					])
				])
			]),
			allOf([
				transactionTransferRelationshipExists(transaction),
				transactionFinancialFactsAreUnchanged(transaction)
			])
		])

	const transactionHasNoTransfer = () => ({ internalTransferId: { isNull: true } })

	policy.organizations.allowRead.where((organization) => isMember(organization.id))
	policy.organizations.allowInsert.where({ ownerId: session.user })
	policy.organizations.allowUpdate
		.whereOld((organization) => isAdmin(organization.id))
		.whereNew((organization) => isAdmin(organization.id))
	policy.organizations.allowDelete.never()

	policy.organizationMembers.allowRead.where((member) =>
		anyOf([{ userId: session.user }, isAdmin(member.organizationId)])
	)
	policy.organizationMembers.allowInsert.where((member) =>
		anyOf([
			isAdmin(member.organizationId),
			allOf([
				{ userId: session.user, role: ORGANIZATION_ROLE.OWNER },
				policy.organizations.exists.where({
					id: member.organizationId,
					ownerId: session.user
				})
			])
		])
	)
	policy.organizationMembers.allowUpdate
		.whereOld((member) => isAdmin(member.organizationId))
		.whereNew((member) => isAdmin(member.organizationId))
	policy.organizationMembers.allowDelete.where((member) =>
		anyOf([{ userId: session.user }, isAdmin(member.organizationId)])
	)

	policy.profiles.allowRead.where((profile) =>
		anyOf([
			{ userId: session.user },
			policy.exists(
				policy.organizationMembers
					.where({ profileId: profile.id })
					.join(policy.organizationMembers, {
						left: 'organizationId',
						right: 'organizationId'
					})
					.where({ userId: session.user })
			)
		])
	)
	policy.profiles.allowInsert.where({ userId: session.user })
	policy.profiles.allowUpdate.whereOld({ userId: session.user }).whereNew({ userId: session.user })
	policy.profiles.allowDelete.never()

	policy.accounts.allowRead.where((account) => canReadAccount(account.id, account.organizationId))
	policy.accounts.allowInsert.where((account) =>
		allOf([isAdmin(account.organizationId), { archivedAt: { isNull: true } }])
	)
	policy.accounts.allowUpdate
		.whereOld((account) => canWriteAccount(account.id, account.organizationId))
		.whereNew((account) => canWriteAccount(account.id, account.organizationId))
	policy.accounts.allowDelete.never()

	policy.accountMemberships.allowRead.where((grant) =>
		anyOf([{ userId: session.user }, isAdmin(grant.organizationId)])
	)
	policy.accountMemberships.allowInsert.where((grant) => isAdmin(grant.organizationId))
	policy.accountMemberships.allowUpdate
		.whereOld((grant) => isAdmin(grant.organizationId))
		.whereNew((grant) => isAdmin(grant.organizationId))
	policy.accountMemberships.allowDelete.where((grant) => isAdmin(grant.organizationId))

	policy.categories.allowRead.where((category) => isMember(category.organizationId))
	policy.categories.allowInsert.where((category) =>
		anyOf([
			isAdmin(category.organizationId),
			hasRole(category.organizationId, ORGANIZATION_ROLE.MEMBER)
		])
	)
	policy.categories.allowUpdate
		.whereOld((category) =>
			allOf([
				anyOf([
					isAdmin(category.organizationId),
					hasRole(category.organizationId, ORGANIZATION_ROLE.MEMBER)
				]),
				{ isSystem: false }
			])
		)
		.whereNew((category) =>
			allOf([
				anyOf([
					isAdmin(category.organizationId),
					hasRole(category.organizationId, ORGANIZATION_ROLE.MEMBER)
				]),
				{ isSystem: false }
			])
		)
	policy.categories.allowDelete.where((category) =>
		allOf([isAdmin(category.organizationId), { isSystem: false }])
	)

	const tagReferencesAreValid = (tag: RowContext<Tag>) =>
		allOf([
			anyOf([{ kind: EXPENSE }, { kind: INCOME }]),
			anyOf([
				{ categoryId: { isNull: true } },
				policy.categories.exists.where({
					id: tag.categoryId,
					organizationId: tag.organizationId,
					kind: tag.kind
				})
			])
		])

	policy.tags.allowRead.where((tag) => isMember(tag.organizationId))
	policy.tags.allowInsert.where((tag) =>
		allOf([
			anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, ORGANIZATION_ROLE.MEMBER)]),
			tagReferencesAreValid(tag)
		])
	)
	policy.tags.allowUpdate
		.whereOld((tag) =>
			anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, ORGANIZATION_ROLE.MEMBER)])
		)
		.whereNew((tag) =>
			allOf([
				anyOf([isAdmin(tag.organizationId), hasRole(tag.organizationId, ORGANIZATION_ROLE.MEMBER)]),
				tagReferencesAreValid(tag),
				// Kind and workspace are immutable so existing assignments stay compatible.
				policy.tags.exists.where({
					id: tag.id,
					organizationId: tag.organizationId,
					kind: tag.kind
				})
			])
		)
	policy.tags.allowDelete.where((tag) => isAdmin(tag.organizationId))

	policy.transactions.allowRead.where((transaction) =>
		canReadAccount(transaction.accountId, transaction.organizationId)
	)
	policy.transactions.allowInsert.where((transaction) =>
		allOf([
			canWriteTransaction(transaction),
			// New manual endpoints must be grounded in existing account permissions, not in
			// the new transfer that itself requires these endpoints. Orphan markers are an
			// integrity boundary; complete-transfer facts and marker updates stay enforced.
			anyOf([
				transactionHasNoTransfer(),
				{ source: TRANSACTION_SOURCE.MANUAL },
				transactionTransferRelationshipExists(transaction)
			])
		])
	)
	policy.transactions.allowUpdate
		.whereOld((transaction) => canWriteAccount(transaction.accountId, transaction.organizationId))
		.whereNew((transaction) =>
			allOf([
				canWriteTransaction(transaction),
				transactionTransferUpdateIsValid(transaction),
				// Preserve tenancy, kind and provenance so edits cannot break provider deduplication.
				policy.transactions.exists.where({
					id: transaction.id,
					organizationId: transaction.organizationId,
					kind: transaction.kind,
					source: transaction.source
				}),
				anyOf([
					allOf([
						{ externalId: { isNull: true } },
						policy.transactions.exists.where({ id: transaction.id, externalId: { isNull: true } })
					]),
					policy.transactions.exists.where({
						id: transaction.id,
						externalId: transaction.externalId
					})
				])
			])
		)
	policy.transactions.allowDelete.where((transaction) =>
		allOf([
			canDeleteAccount(transaction.accountId, transaction.organizationId),
			transactionHasNoTransfer()
		])
	)

	policy.internalTransfers.allowRead.where((transfer) =>
		allOf([
			allowedTo.read('expenseTransaction'),
			allowedTo.read('incomeTransaction'),
			anyOf([
				transferEndpointFactsMatch(transfer),
				transferEndpointsAreUnlinked(transfer),
				transferEndpointsHaveMarkers(transfer)
			])
		])
	)
	policy.internalTransfers.allowInsert.where((transfer) =>
		allOf([
			// Existing unlinked endpoints anchor linking without circular marker-update grants.
			// The final linked pair and a matching pending-unlink record are both valid states.
			anyOf([
				transferEndpointFactsMatch(transfer),
				transferEndpointFactsMatch(transfer, { isNull: true })
			]),
			canWriteTransferAccounts(transfer)
		])
	)
	policy.internalTransfers.allowUpdate.never()
	policy.internalTransfers.allowDelete.where((transfer) => canWriteTransferAccounts(transfer))

	policy.transactionTags.allowRead.where((link) =>
		allOf([
			allowedTo.read('transaction'),
			policy.transactions.exists.where({
				id: link.transactionId,
				organizationId: link.organizationId
			}),
			policy.tags.exists.where({ id: link.tagId, organizationId: link.organizationId })
		])
	)
	policy.transactionTags.allowInsert.where((link) =>
		allOf([
			allowedTo.update('transaction'),
			anyOf(
				([EXPENSE, INCOME] satisfies readonly TransactionRow['kind'][]).map((kind) =>
					allOf([
						policy.transactions.exists.where({
							id: link.transactionId,
							organizationId: link.organizationId,
							kind
						}),
						policy.tags.exists.where({
							id: link.tagId,
							organizationId: link.organizationId,
							kind,
							archivedAt: { isNull: true }
						})
					])
				)
			)
		])
	)
	// Links are immutable; replace an assignment through delete/insert.
	// Archived tags remain readable and removable from historical transactions.
	policy.transactionTags.allowDelete.where((link) =>
		allOf([
			allowedTo.update('transaction'),
			policy.transactions.exists.where({
				id: link.transactionId,
				organizationId: link.organizationId
			}),
			policy.tags.exists.where({ id: link.tagId, organizationId: link.organizationId })
		])
	)

	policy.checks.allowRead.where((check) => canReadAccount(check.accountId, check.organizationId))
	policy.checks.allowInsert.where((check) =>
		allOf([
			canWriteAccount(check.accountId, check.organizationId),
			policy.accounts.exists.where({
				id: check.accountId,
				organizationId: check.organizationId,
				archivedAt: { isNull: true }
			})
		])
	)
	policy.checks.allowUpdate
		.whereOld((check) => canWriteAccount(check.accountId, check.organizationId))
		.whereNew((check) =>
			allOf([
				canWriteAccount(check.accountId, check.organizationId),
				policy.accounts.exists.where({
					id: check.accountId,
					organizationId: check.organizationId,
					archivedAt: { isNull: true }
				}),
				// Moving a Check requires write access to both accounts and preserves its organization.
				policy.checks.exists.where({
					id: check.id,
					organizationId: check.organizationId
				})
			])
		)
	policy.checks.allowDelete.never()

	// Retired embedded details cannot be read or mutated by production clients.
	policy.checkDetails.allowRead.never()
	policy.checkDetails.allowInsert.never()
	policy.checkDetails.allowUpdate.never()
	policy.checkDetails.allowDelete.never()

	const ownsConnection = (connection: { organizationId: IdExpression; ownerId: IdExpression }) =>
		allOf([isAdmin(connection.organizationId), { ownerId: session.user }])
	policy.simplefinConnections.allowRead.where((connection) => isAdmin(connection.organizationId))
	policy.simplefinConnections.allowInsert.where((connection) =>
		allOf([ownsConnection(connection), { accessUrl: '' }])
	)
	policy.simplefinConnections.allowUpdate
		.whereOld((connection) => ownsConnection(connection))
		.whereNew((connection) =>
			allOf([
				ownsConnection(connection),
				{ accessUrl: '' },
				policy.simplefinConnections.exists.where({
					id: connection.id,
					organizationId: connection.organizationId,
					ownerId: connection.ownerId
				})
			])
		)
	policy.simplefinConnections.allowDelete.where((connection) => ownsConnection(connection))

	const ownsSyncAttempt = (
		attempt: Pick<RowContext<SyncAttempt>, 'organizationId' | 'connectionId' | 'initiatedBy'>
	) =>
		allOf([
			isAdmin(attempt.organizationId),
			{ initiatedBy: session.user },
			policy.simplefinConnections.exists.where({
				id: attempt.connectionId,
				organizationId: attempt.organizationId,
				ownerId: attempt.initiatedBy
			})
		])
	policy.simplefinSyncAttempts.allowRead.where((attempt) => isAdmin(attempt.organizationId))
	policy.simplefinSyncAttempts.allowInsert.where((attempt) =>
		allOf([
			ownsSyncAttempt(attempt),
			{ outcome: 'unfinished', finishedAt: { isNull: true }, importSettlement: 'notStarted' }
		])
	)
	policy.simplefinSyncAttempts.allowUpdate
		.whereOld((attempt) => allOf([ownsSyncAttempt(attempt), { outcome: 'unfinished' }]))
		.whereNew((attempt) =>
			allOf([
				ownsSyncAttempt(attempt),
				policy.simplefinSyncAttempts.exists.where({
					id: attempt.id,
					organizationId: attempt.organizationId,
					connectionId: attempt.connectionId,
					initiatedBy: attempt.initiatedBy,
					startedAt: attempt.startedAt
				})
			])
		)
	policy.simplefinSyncAttempts.allowDelete.where((attempt) =>
		allOf([
			ownsSyncAttempt(attempt),
			{ outcome: { ne: 'unfinished' }, finishedAt: { isNull: false } }
		])
	)

	const ownsAccountResult = (
		result: Pick<RowContext<SyncAccountResult>, 'attemptId' | 'organizationId' | 'accountId'>
	) =>
		allOf([
			isAdmin(result.organizationId),
			allowedTo.update('attempt'),
			policy.simplefinSyncAttempts.exists.where({
				id: result.attemptId,
				organizationId: result.organizationId,
				initiatedBy: session.user,
				outcome: 'unfinished'
			}),
			policy.accounts.exists.where({
				id: result.accountId,
				organizationId: result.organizationId
			})
		])
	policy.simplefinSyncAccountResults.allowRead.where(allowedTo.read('attempt'))
	policy.simplefinSyncAccountResults.allowInsert.where((result) => ownsAccountResult(result))
	policy.simplefinSyncAccountResults.allowUpdate
		.whereOld((result) => ownsAccountResult(result))
		.whereNew((result) =>
			allOf([
				ownsAccountResult(result),
				policy.simplefinSyncAccountResults.exists.where({
					id: result.id,
					attemptId: result.attemptId,
					organizationId: result.organizationId,
					accountId: result.accountId,
					accountName: result.accountName
				})
			])
		)
	policy.simplefinSyncAccountResults.allowDelete.where(allowedTo.delete('attempt'))

	policy.simplefinAccountLinks.allowRead.where((link) => isAdmin(link.organizationId))
	const validBankMapping = (link: {
		organizationId: IdExpression
		accountId: IdExpression
		connectionId: IdExpression
	}) =>
		allOf([
			isAdmin(link.organizationId),
			policy.accounts.exists.where({
				id: link.accountId,
				organizationId: link.organizationId,
				archivedAt: { isNull: true }
			}),
			policy.simplefinConnections.exists.where({
				id: link.connectionId,
				organizationId: link.organizationId,
				status: 'active'
			})
		])
	policy.simplefinAccountLinks.allowInsert.where((link) => validBankMapping(link))
	policy.simplefinAccountLinks.allowUpdate
		.whereOld((link) => isAdmin(link.organizationId))
		.whereNew((link) => validBankMapping(link))
	policy.simplefinAccountLinks.allowDelete.where((link) => isAdmin(link.organizationId))

	policy.transactionAttachments.allowRead.where(allowedTo.read('transaction'))
	policy.transactionAttachments.allowInsert.where(allowedTo.update('transaction'))
	policy.transactionAttachments.allowUpdate
		.whereOld(allowedTo.update('transaction'))
		.whereNew((attachment) =>
			allOf([
				allowedTo.update('transaction'),
				policy.files.exists.where({
					id: attachment.fileId,
					transactionId: attachment.transactionId
				})
			])
		)
	policy.transactionAttachments.allowDelete.where(allowedTo.update('transaction'))

	policy.files.allowRead.where((file) =>
		allOf([
			allowedTo.read('transaction'),
			policy.transactionAttachments.exists.where({
				fileId: file.id,
				transactionId: file.transactionId
			})
		])
	)
	policy.files.allowInsert.where((file) =>
		allOf([
			{ transactionId: { isNull: false } },
			allowedTo.update('transaction'),
			policy.transactions.exists.where({ id: file.transactionId })
		])
	)
	policy.files.allowUpdate.never()
	policy.files.allowDelete.where((file) =>
		allOf([
			{ transactionId: { isNull: false } },
			allowedTo.update('transaction'),
			policy.transactions.exists.where({ id: file.transactionId })
		])
	)
	policy.fileParts.allowRead.where(allowedTo.read('file'))
	policy.fileParts.allowInsert.where(allowedTo.insert('file'))
	policy.fileParts.allowUpdate.never()
	policy.fileParts.allowDelete.where(allowedTo.delete('file'))
	policy.uploads.allowRead.never()
	policy.uploads.allowInsert.never()
	policy.uploads.allowUpdate.never()
	policy.uploads.allowDelete.never()

	policy.transactionBatches.allowRead.where((batch) => isMember(batch.organizationId))
	policy.transactionBatches.allowInsert.where((batch) => canWriteAllAccounts(batch.organizationId))
	policy.transactionBatches.allowUpdate
		.whereOld((batch) => canWriteAllAccounts(batch.organizationId))
		.whereNew((batch) => canWriteAllAccounts(batch.organizationId))
	policy.transactionBatches.allowDelete.where((batch) => isAdmin(batch.organizationId))
	policy.batchTemplates.allowRead.where((template) => isMember(template.organizationId))
	policy.batchTemplates.allowInsert.where((template) =>
		canWriteAllAccounts(template.organizationId)
	)
	policy.batchTemplates.allowUpdate
		.whereOld((template) => canWriteAllAccounts(template.organizationId))
		.whereNew((template) => canWriteAllAccounts(template.organizationId))
	policy.batchTemplates.allowDelete.where((template) => isAdmin(template.organizationId))
})

export const previousPermissions = normal

function originalRule(
	table: string,
	operation: 'select' | 'insert' | 'update',
	phase: 'using' | 'with_check'
) {
	const rule = previousPermissions[table]?.[operation]?.[phase]
	if (!rule) throw new Error('Missing Finance policy: ' + table + '.' + operation + '.' + phase)
	return rule
}
const overrides = s.definePermissions(app, ({ policy, session, anyOf, allOf, raw, allowedTo }) => {
	const recovery = (workspaceId: RowRefValue) =>
		policy.restoreOperations.exists.where({
			workspaceId,
			ownerId: session.user,
			status: 'incomplete'
		})
	policy.restoreOperations.allowRead.where((row) =>
		anyOf([
			{ ownerId: session.user, status: 'incomplete' },
			allOf([
				{ status: 'active' },
				policy.organizationMembers.exists.where({
					organizationId: row.workspaceId,
					userId: session.user,
					role: { in: ['owner', 'admin'] }
				})
			])
		])
	)
	policy.restoreOperations.allowInsert.where((row) =>
		allOf([
			{ ownerId: session.user, status: 'incomplete' },
			policy.organizations.exists.where({
				id: row.workspaceId,
				ownerId: session.user,
				restoreOperationId: row.id,
				name: row.workspaceName,
				kind: row.workspaceKind,
				defaultCurrency: row.workspaceCurrency
			})
		])
	)
	policy.restoreOperations.allowUpdate
		.whereOld({ ownerId: session.user, status: 'incomplete' })
		.whereNew((row) =>
			allOf([
				{ ownerId: session.user, status: 'active' },
				policy.restoreOperations.exists.where({
					id: row.id,
					workspaceId: row.workspaceId,
					sourceFileId: row.sourceFileId,
					ownerId: row.ownerId,
					payloadSha256: row.payloadSha256,
					graphSha256: row.graphSha256,
					workspaceName: row.workspaceName,
					workspaceKind: row.workspaceKind,
					workspaceCurrency: row.workspaceCurrency,
					status: 'incomplete'
				})
			])
		)
	policy.restoreOperations.allowDelete.never()

	// Owner membership is the publication boundary. The root remains hidden before it exists.
	policy.organizationMembers.allowInsert.where((row) =>
		allOf([
			raw(originalRule('organizationMembers', 'insert', 'with_check')),
			anyOf([
				policy.organizations.exists.where({
					id: row.organizationId,
					restoreOperationId: { isNull: true }
				}),
				policy.restoreOperations.exists.where({
					workspaceId: row.organizationId,
					status: 'active'
				})
			])
		])
	)
	policy.organizations.allowUpdate
		.whereOld(raw(originalRule('organizations', 'update', 'using')))
		.whereNew((row) =>
			allOf([
				raw(originalRule('organizations', 'update', 'with_check')),
				// Old-schema edits map the unknown reference to null. A sealed operation
				// keeps reconstruction closed after that loss; new bindings stay forbidden.
				anyOf([
					allOf([
						{ restoreOperationId: { isNull: true } },
						anyOf([
							policy.organizations.exists.where({
								id: row.id,
								restoreOperationId: { isNull: true }
							}),
							policy.restoreOperations.exists.where({ workspaceId: row.id, status: 'active' })
						])
					]),
					policy.organizations.exists.where({
						id: row.id,
						restoreOperationId: row.restoreOperationId
					})
				])
			])
		)
	policy.accounts.allowRead.where((row) =>
		anyOf([raw(originalRule('accounts', 'select', 'using')), recovery(row.organizationId)])
	)
	policy.accounts.allowInsert.where((row) =>
		anyOf([raw(originalRule('accounts', 'insert', 'with_check')), recovery(row.organizationId)])
	)
	policy.categories.allowRead.where((row) =>
		anyOf([raw(originalRule('categories', 'select', 'using')), recovery(row.organizationId)])
	)
	policy.categories.allowInsert.where((row) =>
		anyOf([raw(originalRule('categories', 'insert', 'with_check')), recovery(row.organizationId)])
	)
	policy.transactions.allowRead.where((row) =>
		anyOf([raw(originalRule('transactions', 'select', 'using')), recovery(row.organizationId)])
	)
	policy.tags.allowRead.where((row) =>
		anyOf([raw(originalRule('tags', 'select', 'using')), recovery(row.organizationId)])
	)
	policy.tags.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('tags', 'insert', 'with_check')),
			allOf([
				recovery(row.organizationId),
				anyOf([
					{ categoryId: { isNull: true } },
					policy.categories.exists.where({
						id: row.categoryId,
						organizationId: row.organizationId,
						kind: row.kind
					})
				])
			])
		])
	)
	policy.checks.allowRead.where((row) =>
		anyOf([raw(originalRule('checks', 'select', 'using')), recovery(row.organizationId)])
	)
	policy.checks.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('checks', 'insert', 'with_check')),
			allOf([
				recovery(row.organizationId),
				policy.accounts.exists.where({ id: row.accountId, organizationId: row.organizationId })
			])
		])
	)
	policy.transactionBatches.allowRead.where((row) =>
		anyOf([
			raw(originalRule('transactionBatches', 'select', 'using')),
			recovery(row.organizationId)
		])
	)
	policy.transactionBatches.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('transactionBatches', 'insert', 'with_check')),
			recovery(row.organizationId)
		])
	)
	policy.batchTemplates.allowRead.where((row) =>
		anyOf([raw(originalRule('batchTemplates', 'select', 'using')), recovery(row.organizationId)])
	)
	policy.batchTemplates.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('batchTemplates', 'insert', 'with_check')),
			recovery(row.organizationId)
		])
	)
	policy.transactionTags.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('transactionTags', 'insert', 'with_check')),
			allOf([
				recovery(row.organizationId),
				policy.transactions.exists.where({
					id: row.transactionId,
					organizationId: row.organizationId
				}),
				policy.tags.exists.where({ id: row.tagId, organizationId: row.organizationId })
			])
		])
	)
	policy.transactions.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('transactions', 'insert', 'with_check')),
			allOf([
				recovery(row.organizationId),
				{ checkDetailsId: { isNull: true } },
				policy.accounts.exists.where({
					id: row.accountId,
					organizationId: row.organizationId,
					currency: row.currency
				}),
				policy.categories.exists.where({
					id: row.categoryId,
					organizationId: row.organizationId,
					kind: row.kind
				}),
				checkReferenceCondition({
					transaction: row,
					checkExists: (where) => policy.checks.exists.where(where)
				})
			])
		])
	)

	// Backup v1/v2 allow each side to fall back to the legacy shared amount/currency.
	// Match the same resolved facts as validation; never fall back over an explicit value.
	const restoredTransferEndpoint = (row: InternalTransferContext, side: 'expense' | 'income') => {
		const amountMissing =
			side === 'expense'
				? { expenseAmountMinor: { isNull: true } }
				: { incomeAmountMinor: { isNull: true } }
		const amountPresent =
			side === 'expense'
				? { expenseAmountMinor: { isNull: false } }
				: { incomeAmountMinor: { isNull: false } }
		const currencyMissing =
			side === 'expense'
				? { expenseCurrency: { isNull: true } }
				: { incomeCurrency: { isNull: true } }
		const currencyPresent =
			side === 'expense'
				? { expenseCurrency: { isNull: false } }
				: { incomeCurrency: { isNull: false } }
		const endpoint = {
			id: side === 'expense' ? row.expenseTransactionId : row.incomeTransactionId,
			organizationId: row.organizationId,
			accountId: side === 'expense' ? row.expenseAccountId : row.incomeAccountId,
			kind: side,
			internalTransferId: row.id
		}
		const amount = side === 'expense' ? row.expenseAmountMinor : row.incomeAmountMinor
		const currency = side === 'expense' ? row.expenseCurrency : row.incomeCurrency
		return anyOf([
			allOf([
				amountPresent,
				currencyPresent,
				policy.transactions.exists.where({ ...endpoint, amountMinor: amount, currency })
			]),
			allOf([
				amountPresent,
				currencyMissing,
				policy.transactions.exists.where({
					...endpoint,
					amountMinor: amount,
					currency: row.currency
				})
			]),
			allOf([
				amountMissing,
				currencyPresent,
				policy.transactions.exists.where({ ...endpoint, amountMinor: row.amountMinor, currency })
			]),
			allOf([
				amountMissing,
				currencyMissing,
				policy.transactions.exists.where({
					...endpoint,
					amountMinor: row.amountMinor,
					currency: row.currency
				})
			])
		])
	}
	policy.internalTransfers.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('internalTransfers', 'insert', 'with_check')),
			allOf([
				recovery(row.organizationId),
				restoredTransferEndpoint(row, 'expense'),
				restoredTransferEndpoint(row, 'income')
			])
		])
	)

	policy.files.allowRead.where((row) =>
		anyOf([
			raw(originalRule('files', 'select', 'using')),
			allOf([
				{ transactionId: { isNull: true }, accountId: { isNull: true } },
				policy.restoreOperations.exists.where({
					sourceFileId: row.id,
					workspaceId: row.organizationId,
					ownerId: session.user,
					status: 'incomplete'
				})
			]),
			allOf([
				{ transactionId: { isNull: true }, accountId: { isNull: true } },
				policy.exists(
					policy.restoreOperations
						.where({ sourceFileId: row.id, workspaceId: row.organizationId, status: 'active' })
						.join(policy.organizationMembers, { left: 'workspaceId', right: 'organizationId' })
						.where({ userId: session.user, role: { in: ['owner', 'admin'] } })
				)
			])
		])
	)

	policy.files.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('files', 'insert', 'with_check')),
			allOf([
				{ transactionId: { isNull: true }, accountId: { isNull: true } },
				policy.restoreOperations.exists.where({
					sourceFileId: row.id,
					workspaceId: row.organizationId,
					ownerId: session.user,
					status: 'incomplete'
				})
			]),
			allOf([
				policy.exists(
					policy.transactions
						.where({ id: row.transactionId })
						.join(policy.restoreOperations, { left: 'organizationId', right: 'workspaceId' })
						.where({ ownerId: session.user, status: 'incomplete' })
				),
				anyOf([
					{ organizationId: { isNull: true } },
					policy.transactions.exists.where({
						id: row.transactionId,
						organizationId: row.organizationId
					})
				]),
				anyOf([
					{ accountId: { isNull: true } },
					policy.transactions.exists.where({ id: row.transactionId, accountId: row.accountId })
				])
			])
		])
	)
	policy.transactionAttachments.allowInsert.where((row) =>
		anyOf([
			raw(originalRule('transactionAttachments', 'insert', 'with_check')),
			allOf([
				allowedTo.insert('file'),
				policy.files.exists.where({ id: row.fileId, transactionId: row.transactionId })
			])
		])
	)
})

function overridden(table: string, operation: 'select' | 'insert' | 'update') {
	const rule = overrides[table]?.[operation]
	if (!rule) throw new Error('Missing restore policy: ' + table + '.' + operation)
	return rule
}
const operationRules = overrides.restoreOperations
if (!operationRules) throw new Error('Missing restore operation policy')
const permissions = {
	...previousPermissions,
	organizations: {
		...previousPermissions.organizations,
		update: overridden('organizations', 'update')
	},
	organizationMembers: {
		...previousPermissions.organizationMembers,
		insert: overridden('organizationMembers', 'insert')
	},
	accounts: {
		...previousPermissions.accounts,
		select: overridden('accounts', 'select'),
		insert: overridden('accounts', 'insert')
	},
	categories: {
		...previousPermissions.categories,
		select: overridden('categories', 'select'),
		insert: overridden('categories', 'insert')
	},
	transactions: {
		...previousPermissions.transactions,
		select: overridden('transactions', 'select'),
		insert: overridden('transactions', 'insert')
	},
	tags: {
		...previousPermissions.tags,
		select: overridden('tags', 'select'),
		insert: overridden('tags', 'insert')
	},
	checks: {
		...previousPermissions.checks,
		select: overridden('checks', 'select'),
		insert: overridden('checks', 'insert')
	},
	transactionTags: {
		...previousPermissions.transactionTags,
		insert: overridden('transactionTags', 'insert')
	},
	transactionBatches: {
		...previousPermissions.transactionBatches,
		select: overridden('transactionBatches', 'select'),
		insert: overridden('transactionBatches', 'insert')
	},
	batchTemplates: {
		...previousPermissions.batchTemplates,
		select: overridden('batchTemplates', 'select'),
		insert: overridden('batchTemplates', 'insert')
	},
	internalTransfers: {
		...previousPermissions.internalTransfers,
		insert: overridden('internalTransfers', 'insert')
	},
	files: {
		...previousPermissions.files,
		select: overridden('files', 'select'),
		insert: overridden('files', 'insert')
	},
	transactionAttachments: {
		...previousPermissions.transactionAttachments,
		insert: overridden('transactionAttachments', 'insert')
	},
	restoreOperations: operationRules
}

export default permissions
