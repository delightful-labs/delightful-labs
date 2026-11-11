import { publishBankSource } from './reports.fixture.js'
import { afterEach, vi } from 'vitest'
import type { schema } from 'jazz-tools'
import { app, type TransactionRow } from '#lib/schema.js'
import { providerAccountIdentity } from '#lib/integrations/simplefin.js'
import { createTransactionImportMachine } from './import-transaction.js'
import { createAccountImportMachine } from './import-account.js'
import { createImportMachine } from './import.js'
import { createAuthorizationMachine } from './authorization.js'
import { createBankOperationMachine } from './operation.js'
import { createBankSyncMachine } from './index.js'
import { bankObservation } from './availability.js'
import { account, connection, dependencies, id, source } from './test-fixtures.js'
import type {
	BankCommand,
	BankSource,
	LockEvent,
	OperationWork,
	ProviderResponse
} from './types.js'
import type { bankLock } from './lock.js'
import { createActor, createCallbackLogic, createAsyncLogic } from 'xstate'
import type { InputFrom, CallbackActorLogic } from 'xstate'

type TransactionMachine = ReturnType<typeof createTransactionImportMachine>
type YieldLogic = CallbackActorLogic<{ type: 'CONTINUE' }>
type PersistInput = import('./import-transaction.js').TransactionPersistInput
type OutcomeInput = import('./operation.js').OperationOutcomeInput
export const accounts = [account, { ...account, id: id(14), name: 'Savings' }]
export const categories: schema.RowOf<typeof app.categories>[] = [
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
]
export const raw = (identity: string) => ({
	id: identity,
	amount: '-12.34',
	posted: 1792000000,
	description: `Expense ${identity}`
})
export const response: ProviderResponse = {
	errors: [],
	accounts: [
		{
			id: 'checking',
			name: 'Checking',
			currency: 'USD',
			balance: '100.00',
			'available-balance': '90.00',
			'balance-date': 1792000000,
			org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' },
			transactions: [raw('first')]
		},
		{
			id: 'savings',
			name: 'Savings',
			currency: 'USD',
			balance: '250.00',
			'balance-date': 1792000000,
			org: { domain: 'bank.example', 'sfin-url': 'https://bank.example' },
			transactions: [raw('second'), raw('third')]
		}
	]
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
})

export function importFixture(
	options: { existingReadDeadline?: number; readDeadline?: number; yieldControl?: YieldLogic } = {}
) {
	const links: schema.RowOf<typeof app.simplefinAccountLinks>[] = response.accounts.map(
		(provider, index) => {
			const destination = accounts[index]
			if (!destination) throw new Error('Expected matching fixture account')
			return {
				id: id(20 + index),
				organizationId: id(2),
				accountId: destination.id,
				connectionId: connection.id,
				simplefinAccountId: providerAccountIdentity(provider),
				simplefinOrgId: null,
				availableBalance: null,
				balanceDate: null
			}
		}
	)
	const initialSource: BankSource = { ...source, accounts, links }
	const read = vi.fn(() => initialSource)
	const deps = dependencies(() => bankObservation(read()))
	const membership = vi.fn(async () => (source.membership ? [source.membership] : []))
	const authorize = createAuthorizationMachine(deps).provide({
		actors: {
			membership: createAsyncLogic({
				run: (_args: { input: import('./types.js').AuthorizationRequest }) => membership()
			}),
			connections: createAsyncLogic({
				run: async (_args: { input: import('./types.js').AuthorizationRequest }) => [connection]
			}),
			connection: createAsyncLogic({
				run: async (_args: { input: import('./types.js').AuthorizationRequest }) => [connection]
			})
		}
	})
	const stored = new Map<string, TransactionRow>()
	const lookup = vi.fn(async (identity: string): Promise<TransactionRow[]> => {
		const row = stored.get(identity)
		return row ? [row] : []
	})
	const persist = vi.fn<(input: PersistInput, signal: AbortSignal) => Promise<void>>(
		async (input) => {
			stored.set(input.id, {
				...input.values,
				id: input.id,
				memo: null,
				paymentMethod: null,
				batchId: null,
				checkId: null,
				internalTransferId: null,
				checkDetailsId: null
			})
		}
	)
	const transaction = createTransactionImportMachine(deps).provide({
		delays: { readDeadline: options.readDeadline ?? 20000 },
		actors: {
			authorize,
			existing: createAsyncLogic({
				run: ({ input }: { input: Parameters<typeof lookup>[0] }) => lookup(input)
			}),
			persist: createAsyncLogic({
				run: ({ input, signal }: { input: Parameters<typeof persist>[0]; signal: AbortSignal }) =>
					persist(input, signal)
			})
		}
	})
	const loadAccount = vi.fn(async ({ accountId }: { accountId: string; organizationId: string }) =>
		accounts.filter((row) => row.id === accountId)
	)
	const saveBalanceSnapshot = vi.fn(
		async (_input: { linkId: string; availableBalance: string; balanceDate: Date }) => {}
	)
	const existingIds = vi.fn(async ({ accountId }: { accountId: string }) =>
		[...stored.values()].filter((row) => row.accountId === accountId).map(({ id }) => ({ id }))
	)
	const accountImportBase = createAccountImportMachine(deps).provide({
		delays: {
			existingReadDeadline: options.existingReadDeadline ?? 5000
		},
		actors: {
			existing: createAsyncLogic({
				run: ({ input }: { input: { accountId: string; organizationId: string } }) =>
					existingIds(input)
			}),
			transaction,
			account: createAsyncLogic({
				run: ({ input }: { input: Parameters<typeof loadAccount>[0] }) => loadAccount(input)
			}),
			saveBalanceSnapshot: createAsyncLogic({
				run: ({ input }: { input: Parameters<typeof saveBalanceSnapshot>[0] }) =>
					saveBalanceSnapshot(input)
			})
		}
	})
	const accountImport = options.yieldControl
		? accountImportBase.provide({ actors: { yieldControl: options.yieldControl } })
		: accountImportBase
	const mappings = vi.fn(async () => links)
	const loadCategories = vi.fn(async () => categories)
	const imports = createImportMachine(deps).provide({
		actors: {
			account: accountImport,
			mappings: createAsyncLogic({
				run: (_args: { input: InputFrom<ReturnType<typeof createImportMachine>> }) => mappings()
			}),
			categories: createAsyncLogic({
				run: (_args: { input: InputFrom<ReturnType<typeof createImportMachine>> }) =>
					loadCategories()
			})
		}
	})
	const unlock = vi.fn(async () => 'synthetic-access-url')
	const fetch = vi.fn(async (): Promise<ProviderResponse> => response)
	const outcome = vi.fn<(input: OutcomeInput, signal: AbortSignal) => Promise<void>>(async () => {})
	const disconnect = vi.fn<(input: OperationWork, signal: AbortSignal) => Promise<void>>(
		async () => {}
	)
	const acquire = vi.fn()
	const release = vi.fn()
	const operation = createBankOperationMachine(deps).provide({
		actors: {
			authorize,
			importTransactions: imports,
			unlock: createAsyncLogic<string, OperationWork>({ run: unlock }),
			fetchProvider: createAsyncLogic<ProviderResponse, { work: OperationWork; accessUrl: string }>(
				{ run: fetch }
			),
			persistOutcome: createAsyncLogic({
				run: ({ input, signal }: { input: Parameters<typeof outcome>[0]; signal: AbortSignal }) =>
					outcome(input, signal)
			}),
			disconnect: createAsyncLogic({
				run: ({
					input,
					signal
				}: {
					input: Parameters<typeof disconnect>[0]
					signal: AbortSignal
				}) => disconnect(input, signal)
			}),
			lock: createCallbackLogic<LockEvent, InputFrom<typeof bankLock>>(({ sendBack }) => {
				acquire()
				sendBack({ type: 'LOCK_ACQUIRED' })
				return release
			})
		}
	})
	const bank = createBankSyncMachine(
		{ db: deps.db, read, passkeyName: deps.passkeyName },
		operation
	)
	function start(command: BankCommand = { type: 'SYNC' }, machine = bank) {
		const actor = createActor(machine).start()
		cleanups.push(() => actor.stop())
		publishBankSource(actor, read(), 0)
		actor.send(command)
		const child = actor.getSnapshot().children.operation
		if (!child) throw new Error('Expected active operation')
		return { bank: actor, operation: child }
	}
	function startTransaction(machine = transaction, knownIds?: ReadonlySet<string>) {
		const provider = response.accounts[0]
		if (!provider) throw new Error('Expected provider')
		const actor = createActor(machine, {
			input: {
				...(knownIds ? { existingIds: knownIds } : {}),
				work: {
					command: { type: 'SYNC' },
					current: connection,
					scope: { ownerId: id(1), organizationId: id(2), connectionId: connection.id },
					trace: {
						id: 'unit',
						log: vi.fn(),
						failed: vi.fn(),
						step: async (_stage, effect) => effect()
					},
					attemptAt: new Date()
				},
				provider,
				account,
				categories,
				raw: raw('first')
			}
		}).start()
		cleanups.push(() => actor.stop())
		return actor
	}
	return {
		start,
		startTransaction,
		transaction,
		accountImport,
		imports,
		operation,
		bank,
		authorize,
		read,
		initialSource,
		membership,
		persist,
		lookup,
		stored,
		existingIds,
		loadAccount,
		saveBalanceSnapshot,
		mappings,
		loadCategories,
		unlock,
		fetch,
		outcome,
		disconnect,
		acquire,
		release
	}
}
