import { describe, expect, it, vi } from 'vitest'
import { createTransactionImportMachine } from './import-transaction.js'
import { createAuthorizationMachine } from './authorization.js'
import { account, connection, dependencies, id, source } from './test-fixtures.js'
import type { BankTrace } from '#lib/integrations/diagnostics.js'
import type { TransactionRow } from '#lib/schema.js'
import { createActor, toPromise, createAsyncLogic } from 'xstate'
import type { InputFrom } from 'xstate'

type Input = InputFrom<ReturnType<typeof createTransactionImportMachine>>
const trace: BankTrace = {
	id: 'test',
	log: vi.fn(),
	failed: vi.fn(),
	step: async (_stage, work) => work()
}
const raw = {
	id: 'transaction',
	amount: '-12.34',
	posted: 1792000000,
	description: 'Imported expense'
}
const input: Input = {
	work: {
		command: { type: 'SYNC' },
		current: connection,
		scope: { ownerId: id(1), organizationId: id(2), connectionId: id(3) },
		trace,
		attemptAt: new Date()
	},
	provider: {
		id: 'checking',
		name: 'Provider Checking',
		currency: 'USD',
		org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' }
	},
	account,
	categories: [
		{
			id: id(6),
			organizationId: id(2),
			name: 'Expense',
			kind: 'expense',
			isSystem: true,
			archivedAt: null
		},
		{
			id: id(7),
			organizationId: id(2),
			name: 'Income',
			kind: 'income',
			isSystem: true,
			archivedAt: null
		}
	],
	raw: { id: 'transaction', amount: '-12.34', posted: 1792000000, description: 'Imported expense' }
}
function start(current: Input = input, rows: TransactionRow[] = []) {
	const authorize = createAuthorizationMachine(dependencies()).provide({
		actors: {
			membership: createAsyncLogic({
				run: async () => (source.membership ? [source.membership] : [])
			}),
			demoId: createAsyncLogic({ run: async () => id(99) }),
			connections: createAsyncLogic({ run: async () => [connection] }),
			connection: createAsyncLogic({ run: async () => [connection] })
		}
	})
	const persist = vi.fn(async () => {})
	const lookup = vi.fn(async () => rows)
	const machine = createTransactionImportMachine(dependencies()).provide({
		actors: {
			authorize,
			identity: createAsyncLogic({ run: async () => id(8) }),
			existing: createAsyncLogic({ run: lookup }),
			persist: createAsyncLogic({ run: persist })
		}
	})
	return { actor: createActor(machine, { input: current }).start(), persist, lookup }
}

describe('transaction import decisions', () => {
	it.each([
		{ reason: 'invalidSchema', change: { raw: {} } },
		{ reason: 'pending', change: { raw: { ...raw, pending: true } } },
		{ reason: 'unsupportedCurrency', change: { provider: { ...input.provider, currency: 'EUR' } } },
		{ reason: 'currencyMismatch', change: { account: { ...account, currency: 'EUR' } } },
		{ reason: 'invalidAmount', change: { raw: { ...raw, amount: '-99999999999999999999' } } },
		{ reason: 'invalidDate', change: { raw: { ...raw, posted: 9e12 } } }
	] satisfies { reason: string; change: Partial<Input> }[])(
		'omits $reason before lookup or persistence',
		async ({ reason, change }) => {
			const { actor, persist, lookup } = start({ ...input, ...change })
			await expect(toPromise(actor)).resolves.toEqual({ kind: 'omitted', reason })
			expect(lookup).not.toHaveBeenCalled()
			expect(persist).not.toHaveBeenCalled()
		}
	)

	it('imports integer minor units and preserves provider provenance', async () => {
		const { actor, persist } = start()
		await expect(toPromise(actor)).resolves.toEqual({ kind: 'imported' })
		expect(persist).toHaveBeenCalledTimes(1)
		expect(actor.getSnapshot().context.values).not.toHaveProperty('memo')
		expect(actor.getSnapshot().context.values).toMatchObject({
			amountMinor: 1234,
			kind: 'expense',
			accountId: account.id,
			organizationId: id(2),
			source: 'simplefin',
			description: 'Imported expense'
		})
	})

	it('preserves user-edited values when the stable provider transaction is imported again', async () => {
		const row: TransactionRow = {
			id: id(8),
			organizationId: id(2),
			accountId: account.id,
			categoryId: id(6),
			kind: 'expense',
			bookedOn: '2026-10-14',
			amountMinor: 5678,
			currency: 'USD',
			memo: 'User notes',
			description: 'User description',
			source: 'simplefin',
			externalId: 'external',
			paymentMethod: null,
			batchId: null,
			checkId: null,
			checkDetailsId: null,
			internalTransferId: null
		}
		const { actor, persist } = start(input, [row])
		await expect(toPromise(actor)).resolves.toEqual({ kind: 'existing' })
		expect(persist).not.toHaveBeenCalled()
	})

	it('fails without persistence when no system category can accept the transaction', async () => {
		const { actor, persist } = start({ ...input, categories: [] })
		await expect(toPromise(actor)).resolves.toEqual({
			kind: 'failed',
			error: new Error('mapping')
		})
		expect(persist).not.toHaveBeenCalled()
	})
})
