import { describe, expect, it } from 'vitest'
import {
	createTransactionEntryAvailability,
	selectTransactionEntryAvailability,
	transactionEntryScope,
	sameTransactionEntryScope,
	applicableTransactionTags
} from './transaction-entry.js'
import type { TransactionEntryObservation } from '#lib/contracts/transaction-entry-contract.js'
import type { Tag } from '#lib/schema.js'
import { initialTransition } from 'xstate'

const binding = {}
const organizationId = '22222222-2222-4222-8222-222222222222'
function facts(): TransactionEntryObservation {
	return {
		binding,
		identityId: 'user',
		organizationId,
		kind: 'expense',
		sessionReady: true,
		loading: false,
		failed: false,
		membership: {
			id: 'member',
			userId: 'user',
			organizationId,
			role: 'member',
			accountAccessMode: 'selected',
			profileId: null
		},
		grants: [{ accountId: '11111111-1111-4111-8111-111111111111', access: 'write' }],
		accounts: [
			{
				id: '11111111-1111-4111-8111-111111111111',
				organizationId,
				name: 'Wallet',
				kind: 'cash',
				currency: 'USD',
				archivedAt: null
			}
		],
		categories: [
			{
				id: '33333333-3333-4333-8333-333333333333',
				organizationId,
				name: 'Food',
				kind: 'expense',
				isSystem: false,
				archivedAt: null
			}
		],
		tags: []
	}
}

function readiness(observation: TransactionEntryObservation) {
	return selectTransactionEntryAvailability(
		initialTransition(createTransactionEntryAvailability(binding), {
			revision: 1,
			facts: observation
		})[0]
	).readiness
}

describe('transaction entry availability', () => {
	it('requires an active session, workspace, writable account, and category', () => {
		expect(readiness(facts())).toEqual({ kind: 'ready' })
		expect(readiness({ ...facts(), sessionReady: false })).toEqual({
			kind: 'blocked',
			reason: 'sessionUnavailable'
		})
		expect(readiness({ ...facts(), organizationId: null })).toEqual({
			kind: 'blocked',
			reason: 'selectWorkspace'
		})
		expect(readiness({ ...facts(), grants: [] })).toEqual({ kind: 'blocked', reason: 'readOnly' })
	})

	it('scopes edit capabilities to the exact transaction', () => {
		const initial = transactionEntryScope({ ...facts(), transactionId: 'transaction' })
		expect(
			sameTransactionEntryScope(
				initial,
				transactionEntryScope({ ...facts(), transactionId: 'transaction' })
			)
		).toBe(true)
		expect(
			sameTransactionEntryScope(
				initial,
				transactionEntryScope({ ...facts(), transactionId: 'other' })
			)
		).toBe(false)
	})

	it('only offers tags compatible with the active organization and transaction kind', () => {
		const compatible = {
			id: 'tag',
			organizationId,
			name: 'Food',
			kind: 'expense',
			categoryId: null,
			archivedAt: null
		} satisfies Tag
		const observation = {
			...facts(),
			tags: [
				compatible,
				{ ...compatible, id: 'income', kind: 'income' } satisfies Tag,
				{ ...compatible, id: 'archived', archivedAt: new Date() } satisfies Tag,
				{ ...compatible, id: 'foreign', organizationId: 'other' } satisfies Tag
			]
		}
		expect(applicableTransactionTags(observation)).toEqual([compatible])
	})
})
