import { Transaction } from 'jazz-tools'
import { vi } from 'vitest'
import type { Category, Organization } from '../../schema.js'

export const userId = '11111111-1111-4111-8111-111111111111'
export const organizationId = '33333333-3333-4333-8333-333333333333'
export const profileId = '22222222-2222-4222-8222-222222222222'
export const organization: Organization = {
	id: organizationId,
	ownerId: userId,
	name: 'Fixture',
	kind: 'personal',
	defaultCurrency: 'USD'
}
export const categories: Category[] = [
	{
		id: '55555555-5555-4555-8555-555555555555',
		organizationId,
		name: 'Expense',
		kind: 'expense',
		isSystem: true,
		archivedAt: null
	},
	{
		id: '66666666-6666-4666-8666-666666666666',
		organizationId,
		name: 'Income',
		kind: 'income',
		isSystem: true,
		archivedAt: null
	}
]
export function seedFixture() {
	const unavailable = () => {
		throw new Error('Unit fixture must not open a Jazz runtime')
	}
	const tx = new Transaction('serializable', unavailable)
	const reads = new Transaction('mergeable', unavailable)
	const all = vi.spyOn(reads, 'all').mockResolvedValue([])
	all
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([organization])
		.mockResolvedValueOnce(categories)
	const recheck = vi.spyOn(tx, 'all').mockResolvedValue([])
	recheck
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([organization])
		.mockResolvedValueOnce(categories)
	const insert = vi.spyOn(tx, 'insert').mockImplementation(vi.fn().mockReturnValue({}))
	const wait = vi.fn(async () => {})
	const commit = vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait }))
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const beginSerializableTransaction = vi.fn(() => tx)
	const db = { all: reads.all.bind(reads), beginSerializableTransaction }
	return {
		input: { db, organizationId, userId, profileId },
		all,
		tx,
		recheck,
		insert,
		wait,
		commit,
		rollback,
		beginSerializableTransaction
	}
}
