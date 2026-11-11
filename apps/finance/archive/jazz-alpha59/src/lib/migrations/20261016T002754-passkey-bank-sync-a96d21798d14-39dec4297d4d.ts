import { schema as s } from 'jazz-tools'

export default s.defineMigration({
	// Existing rows gain only null defaults; no finance records are removed.
	migrate: {
		simplefinAccountLinks: {
			connectionId: { _type: 'add', sqlType: 'UUID', default: null }
		},

		simplefinConnections: {
			ownerId: { _type: 'add', sqlType: 'UUID', default: null },
			credentialVersion: s.add.int({ default: null }),
			credentialId: s.add.string({ default: null }),
			prfSalt: s.add.string({ default: null }),
			iv: s.add.string({ default: null }),
			ciphertext: s.add.string({ default: null }),
			lastOutcome: s.add.enum('succeeded', 'partial', 'failed', { default: null }),
			importedCount: s.add.int({ default: null }),
			existingCount: s.add.int({ default: null }),
			omittedCount: s.add.int({ default: null })
		}
	},
	fromHash: 'a96d21798d14',
	toHash: '39dec4297d4d',
	from: {
		accountMemberships: s.table(
			{
				organizationId: s.uuid(),
				userId: s.uuid(),
				accountId: s.uuid(),
				access: s.enum('read', 'write')
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId'),
				accountIdRelation: s.rel('accounts', 'accountId')
			}
		),
		accounts: s.table(
			{
				organizationId: s.uuid(),
				name: s.string(),
				kind: s.enum('cash', 'bank', 'card'),
				currency: s.string(),
				archivedAt: s.timestamp().optional()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId')
			}
		),
		batchTemplates: s.table(
			{
				organizationId: s.uuid(),
				name: s.string()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId')
			}
		),
		categories: s.table(
			{
				organizationId: s.uuid(),
				name: s.string(),
				kind: s.enum('expense', 'income'),
				isSystem: s.boolean(),
				archivedAt: s.timestamp().optional()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId')
			}
		),
		checkDetails: s.table(
			{
				transactionId: s.uuid(),
				organizationId: s.uuid(),
				accountId: s.uuid(),
				checkNumber: s.string(),
				checkDate: s.string(),
				payerName: s.string().optional(),
				bankName: s.string().optional(),
				memoOnCheck: s.string().optional()
			},
			{
				transactionIdRelation: s.rel('transactions', 'transactionId'),
				organizationIdRelation: s.rel('organizations', 'organizationId'),
				accountIdRelation: s.rel('accounts', 'accountId')
			}
		),
		organizationMembers: s.table(
			{
				organizationId: s.uuid(),
				userId: s.uuid(),
				profileId: s.uuid().optional(),
				role: s.enum('owner', 'admin', 'member', 'viewer'),
				accountAccessMode: s.enum('all', 'selected')
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId'),
				profileIdRelation: s.rel('profiles', 'profileId')
			}
		),
		organizations: s.table(
			{
				name: s.string(),
				kind: s.enum('personal', 'business'),
				defaultCurrency: s.string(),
				ownerId: s.uuid()
			},
			{}
		),
		profiles: s.table(
			{
				userId: s.uuid(),
				displayName: s.string().optional(),
				avatarData: s.bytes().optional(),
				avatarMimeType: s.enum('image/png', 'image/jpeg', 'image/webp').optional()
			},
			{}
		),
		simplefinAccountLinks: s.table(
			{
				organizationId: s.uuid(),
				accountId: s.uuid(),
				simplefinAccountId: s.string(),
				simplefinOrgId: s.string().optional()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId'),
				accountIdRelation: s.rel('accounts', 'accountId')
			}
		),
		simplefinConnections: s.table(
			{
				organizationId: s.uuid(),
				accessUrl: s.string(),
				status: s.enum('active', 'error', 'revoked'),
				lastSyncAt: s.timestamp().optional(),
				lastError: s.string().optional(),
				claimedAt: s.timestamp()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId')
			}
		),
		tags: s.table(
			{
				organizationId: s.uuid(),
				name: s.string(),
				categoryId: s.uuid().optional(),
				archivedAt: s.timestamp().optional()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId'),
				categoryIdRelation: s.rel('categories', 'categoryId')
			}
		),
		transactionAttachments: s.table(
			{
				transactionId: s.uuid(),
				fileId: s.uuid()
			},
			{
				transactionIdRelation: s.rel('transactions', 'transactionId')
			}
		),
		transactionBatches: s.table(
			{
				organizationId: s.uuid(),
				name: s.string().optional()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId')
			}
		),
		transactions: s.table(
			{
				amountMinor: s.int(),
				kind: s.enum('expense', 'income'),
				currency: s.string(),
				categoryId: s.uuid(),
				accountId: s.uuid(),
				organizationId: s.uuid(),
				bookedOn: s.string(),
				memo: s.string().optional(),
				paymentMethod: s.enum('cash', 'check', 'transfer', 'electronic').optional(),
				checkDetailsId: s.uuid().optional(),
				source: s.enum('manual', 'simplefin'),
				externalId: s.string().optional(),
				batchId: s.uuid().optional()
			},
			{
				categoryIdRelation: s.rel('categories', 'categoryId'),
				accountIdRelation: s.rel('accounts', 'accountId'),
				organizationIdRelation: s.rel('organizations', 'organizationId'),
				checkDetailsIdRelation: s.rel('checkDetails', 'checkDetailsId'),
				batchIdRelation: s.rel('transactionBatches', 'batchId')
			}
		),
		transactionTags: s.table(
			{
				organizationId: s.uuid(),
				transactionId: s.uuid(),
				tagId: s.uuid()
			},
			{
				organizationIdRelation: s.rel('organizations', 'organizationId'),
				transactionIdRelation: s.rel('transactions', 'transactionId'),
				tagIdRelation: s.rel('tags', 'tagId')
			}
		)
	},
	to: {
		accountMemberships: s.table(
			{
				organizationId: s.uuid(),
				userId: s.uuid(),
				accountId: s.uuid(),
				access: s.enum('read', 'write')
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				account: s.rel('accounts', 'accountId')
			}
		),
		accounts: s.table(
			{
				organizationId: s.uuid(),
				name: s.string(),
				kind: s.enum('cash', 'bank', 'card'),
				currency: s.string(),
				archivedAt: s.timestamp().optional()
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				transactions: s.reverse('transactions', 'account'),
				memberships: s.reverse('accountMemberships', 'account')
			}
		),
		batchTemplates: s.table(
			{
				organizationId: s.uuid(),
				name: s.string()
			},
			{
				organization: s.rel('organizations', 'organizationId')
			}
		),
		categories: s.table(
			{
				organizationId: s.uuid(),
				name: s.string(),
				kind: s.enum('expense', 'income'),
				isSystem: s.boolean(),
				archivedAt: s.timestamp().optional()
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				transactions: s.reverse('transactions', 'category'),
				tags: s.reverse('tags', 'category')
			}
		),
		checkDetails: s.table(
			{
				transactionId: s.uuid(),
				organizationId: s.uuid(),
				accountId: s.uuid(),
				checkNumber: s.string(),
				checkDate: s.string(),
				payerName: s.string().optional(),
				bankName: s.string().optional(),
				memoOnCheck: s.string().optional()
			},
			{
				transaction: s.rel('transactions', 'transactionId'),
				organization: s.rel('organizations', 'organizationId'),
				account: s.rel('accounts', 'accountId')
			}
		),
		organizationMembers: s.table(
			{
				organizationId: s.uuid(),
				userId: s.uuid(),
				profileId: s.uuid().optional(),
				role: s.enum('owner', 'admin', 'member', 'viewer'),
				accountAccessMode: s.enum('all', 'selected')
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				profile: s.rel('profiles', 'profileId')
			}
		),
		organizations: s.table(
			{
				name: s.string(),
				kind: s.enum('personal', 'business'),
				defaultCurrency: s.string(),
				ownerId: s.uuid()
			},
			{
				members: s.reverse('organizationMembers', 'organization'),
				accounts: s.reverse('accounts', 'organization'),
				categories: s.reverse('categories', 'organization'),
				tags: s.reverse('tags', 'organization'),
				transactions: s.reverse('transactions', 'organization'),
				simplefinConnections: s.reverse('simplefinConnections', 'organization'),
				batches: s.reverse('transactionBatches', 'organization'),
				batchTemplates: s.reverse('batchTemplates', 'organization')
			}
		),
		profiles: s.table(
			{
				userId: s.uuid(),
				displayName: s.string().optional(),
				avatarData: s.bytes().optional(),
				avatarMimeType: s.enum('image/png', 'image/jpeg', 'image/webp').optional()
			},
			{
				memberships: s.reverse('organizationMembers', 'profile')
			}
		),
		simplefinAccountLinks: s.table(
			{
				organizationId: s.uuid(),
				accountId: s.uuid(),
				connectionId: s.uuid().optional(),
				simplefinAccountId: s.string(),
				simplefinOrgId: s.string().optional()
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				account: s.rel('accounts', 'accountId')
			}
		),
		simplefinConnections: s.table(
			{
				organizationId: s.uuid(),
				accessUrl: s.string(),
				ownerId: s.uuid().optional(),
				credentialVersion: s.int().optional(),
				credentialId: s.string().optional(),
				prfSalt: s.string().optional(),
				iv: s.string().optional(),
				ciphertext: s.string().optional(),
				lastOutcome: s.enum('succeeded', 'partial', 'failed').optional(),
				importedCount: s.int().optional(),
				existingCount: s.int().optional(),
				omittedCount: s.int().optional(),
				status: s.enum('active', 'error', 'revoked'),
				lastSyncAt: s.timestamp().optional(),
				lastError: s.string().optional(),
				claimedAt: s.timestamp()
			},
			{
				organization: s.rel('organizations', 'organizationId')
			}
		),
		tags: s.table(
			{
				organizationId: s.uuid(),
				name: s.string(),
				categoryId: s.uuid().optional(),
				archivedAt: s.timestamp().optional()
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				category: s.rel('categories', 'categoryId'),
				transactionTags: s.reverse('transactionTags', 'tag')
			}
		),
		transactionAttachments: s.table(
			{
				transactionId: s.uuid(),
				fileId: s.uuid()
			},
			{
				transaction: s.rel('transactions', 'transactionId')
			}
		),
		transactionBatches: s.table(
			{
				organizationId: s.uuid(),
				name: s.string().optional()
			},
			{
				organization: s.rel('organizations', 'organizationId')
			}
		),
		transactions: s.table(
			{
				amountMinor: s.int(),
				kind: s.enum('expense', 'income'),
				currency: s.string(),
				categoryId: s.uuid(),
				accountId: s.uuid(),
				organizationId: s.uuid(),
				bookedOn: s.string(),
				memo: s.string().optional(),
				paymentMethod: s.enum('cash', 'check', 'transfer', 'electronic').optional(),
				checkDetailsId: s.uuid().optional(),
				source: s.enum('manual', 'simplefin'),
				externalId: s.string().optional(),
				batchId: s.uuid().optional()
			},
			{
				account: s.rel('accounts', 'accountId'),
				category: s.rel('categories', 'categoryId'),
				organization: s.rel('organizations', 'organizationId'),
				batch: s.rel('transactionBatches', 'batchId'),
				tags: s.reverse('transactionTags', 'transaction'),
				checkDetails: s.rel('checkDetails', 'checkDetailsId'),
				attachments: s.reverse('transactionAttachments', 'transaction')
			}
		),
		transactionTags: s.table(
			{
				organizationId: s.uuid(),
				transactionId: s.uuid(),
				tagId: s.uuid()
			},
			{
				organization: s.rel('organizations', 'organizationId'),
				transaction: s.rel('transactions', 'transactionId'),
				tag: s.rel('tags', 'tagId')
			}
		)
	}
})
