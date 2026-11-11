import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { unlockCredential } from '#lib/integrations/passkey.js'
import { fetchAccounts } from '#lib/integrations/simplefin.js'
import { createBankTrace } from '#lib/integrations/diagnostics.js'
import { createBankOperationMachine } from './operation.js'
import type { createPreparationMachine } from './preparation.js'
import type { bankLock } from './lock.js'
import type {
	BankCommand,
	Connection,
	Dependencies,
	ImportCounts,
	LockEvent,
	OperationWork,
	ProviderResponse
} from './types.js'
import {
	createActor,
	createMachine,
	createCallbackLogic,
	toPromise,
	waitFor,
	createAsyncLogic
} from 'xstate'
import type { ActorFromLogic, InputFrom, OutputFrom } from 'xstate'

vi.mock('#lib/integrations/passkey.js', () => ({ unlockCredential: vi.fn() }))
vi.mock('#lib/integrations/simplefin.js', () => ({
	fetchAccounts: vi.fn(),
	providerAccountIdentity: (account: { id: string }) => account.id,
	providerBalanceSnapshot: () => undefined,
	simplefinDemo: false
}))
vi.mock('#lib/integrations/diagnostics.js', () => ({ createBankTrace: vi.fn() }))
vi.mock('./preparation.js', () => ({
	createPreparationMachine: () =>
		success({ ok: true, value: { scope, connection } } satisfies OutputFrom<
			ReturnType<typeof createPreparationMachine>
		>)
}))
vi.mock('./authorization.js', () => ({
	createAuthorizationMachine: () => success({ error: undefined })
}))
vi.mock('./accounts.js', () => ({
	createAccountMappingMachine: () => success({ ok: true, value: undefined })
}))
vi.mock('./import.js', () => ({
	createImportMachine: () =>
		success(
			{
				kind: 'complete',
				counts,
				error: undefined,
				settlement: 'settled',
				accountResults: []
			} satisfies OutputFrom<ReturnType<typeof import('./import.js').createImportMachine>>,
			imported
		)
}))

function success<T>(output: T, onStart: () => void = () => {}) {
	return createMachine({
		entry: onStart,
		initial: 'complete',
		states: { complete: { type: 'final' } },
		output: () => output
	})
}
type OperationActor = ActorFromLogic<ReturnType<typeof createBankOperationMachine>>
type PersistenceInput = {
	work: OperationWork
	counts: ImportCounts
	outcome:
		| { lastOutcome: 'succeeded' | 'partial'; lastError: null }
		| { lastOutcome: 'failed'; lastError: 'operation-failed' }
}
const scope = { ownerId: 'owner', organizationId: 'organization', connectionId: 'connection' }
const connection: Connection = {
	id: scope.connectionId,
	organizationId: scope.organizationId,
	ownerId: scope.ownerId,
	status: 'active',
	accessUrl: '',
	credentialVersion: 1,
	credentialId: 'credential',
	prfSalt: 'salt',
	iv: 'iv',
	ciphertext: 'ciphertext',
	lastOutcome: null,
	importedCount: null,
	existingCount: null,
	omittedCount: null,
	lastSyncAt: null,
	lastError: null,
	claimedAt: new Date('2026-10-17T00:00:00Z')
}
const response: ProviderResponse = { errors: [], accounts: [] }
let counts = { imported: 0, existing: 0, omitted: 0 }
const failed = vi.fn()
const releaseLock = vi.fn()
const acquireLock = vi.fn<() => void>()
const imported = vi.fn()
const persist = vi.fn<(input: PersistenceInput, signal: AbortSignal) => Promise<void>>()
const actors: OperationActor[] = []

function start(type: 'DISCOVER' | 'SYNC'): OperationActor {
	// All database actors are isolated; no Jazz runtime or provider is contacted.
	const db = vi.fn<() => Dependencies['db']>()()
	const machine = createBankOperationMachine({
		db,
		observe: () => ({
			userId: scope.ownerId,
			organizationId: scope.organizationId,
			allowed: true,
			connected: true,
			sessionReady: true,
			connection
		}),
		passkeyName: () => 'Test'
	}).provide({
		actors: {
			lock: createCallbackLogic<LockEvent, InputFrom<typeof bankLock>>(({ sendBack }) => {
				acquireLock()
				sendBack({ type: 'LOCK_ACQUIRED' })
				return releaseLock
			}),
			persistOutcome: createAsyncLogic<void, PersistenceInput>({
				run: ({ input, signal }) => persist(input, signal)
			})
		}
	})
	const command: BankCommand = { type }
	const actor = createActor(machine, { input: { command, discovered: [] } }).start()
	actors.push(actor)
	return actor
}

beforeEach(() => {
	vi.resetAllMocks()
	counts = { imported: 0, existing: 0, omitted: 0 }
	vi.mocked(createBankTrace).mockReturnValue({
		id: 'trace',
		log: vi.fn(),
		failed,
		step: async (_stage, work) => work()
	})
	vi.mocked(unlockCredential).mockResolvedValue('secret-access-url')
	vi.mocked(fetchAccounts).mockResolvedValue(response)
	persist.mockResolvedValue(undefined)
})
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})

function expectCleanup(actor: OperationActor) {
	expect(actor.getSnapshot().context).toMatchObject({
		work: undefined,
		accessUrl: undefined,
		response: undefined
	})
	expect(releaseLock).toHaveBeenCalledOnce()
}

describe('operation actor failure boundaries', () => {
	it.each(['DISCOVER', 'SYNC'] satisfies ('DISCOVER' | 'SYNC')[])(
		'handles a lock actor throwing before %s acquisition',
		async (command) => {
			acquireLock.mockImplementationOnce(() => {
				throw new Error('locking_unavailable')
			})
			const actor = start(command)
			expect(await toPromise(actor)).toEqual({
				kind: 'failed',
				error: new Error('locking_unavailable'),
				counts,
				discovered: undefined,
				accountResults: [],
				settlement: 'settled'
			})
			expect(actor.getSnapshot().context).toMatchObject({
				work: undefined,
				accessUrl: undefined,
				response: undefined
			})
			expect(acquireLock).toHaveBeenCalledOnce()
			expect(releaseLock).not.toHaveBeenCalled()
			expect(unlockCredential).not.toHaveBeenCalled()
			expect(fetchAccounts).not.toHaveBeenCalled()
			expect(imported).not.toHaveBeenCalled()
			expect(persist).not.toHaveBeenCalled()
		}
	)

	it.each(['omissions', 'provider errors'])(
		'persists the same partial outcome it returns for %s',
		async (reason) => {
			counts = { imported: 2, existing: 1, omitted: reason === 'omissions' ? 1 : 0 }
			if (reason === 'provider errors')
				vi.mocked(fetchAccounts).mockResolvedValueOnce({
					errors: ['Synthetic provider warning'],
					accounts: []
				})
			const actor = start('SYNC')
			expect(await toPromise(actor)).toMatchObject({ kind: 'partial', counts })
			expect(persist).toHaveBeenCalledOnce()
			expect(persist.mock.calls[0]?.[0]).toMatchObject({
				counts,
				outcome: { lastOutcome: 'partial', lastError: null }
			})
			expectCleanup(actor)
		}
	)

	it.each([
		{ stage: 'unlock', command: 'DISCOVER', code: 'unlock_failure' },
		{ stage: 'unlock', command: 'SYNC', code: 'unlock_failure' },
		{ stage: 'fetch', command: 'DISCOVER', code: 'provider_failure' },
		{ stage: 'fetch', command: 'SYNC', code: 'provider_failure' }
	] satisfies { stage: string; command: 'DISCOVER' | 'SYNC'; code: string }[])(
		'classifies $command $stage failure without retaining provider details',
		async ({ stage, command, code }) => {
			const raw = new Error('unsafe secret-access-url provider response')
			if (stage === 'unlock') vi.mocked(unlockCredential).mockRejectedValueOnce(raw)
			else vi.mocked(fetchAccounts).mockRejectedValueOnce(raw)
			const actor = start(command)
			expect(await toPromise(actor)).toEqual({
				kind: 'failed',
				error: new Error(code),
				counts,
				discovered: undefined,
				accountResults: [],
				settlement: 'settled'
			})
			expect(failed).toHaveBeenCalledWith('operation.failed', new Error(code))
			expect(failed).not.toHaveBeenCalledWith('operation.failed', raw)
			if (stage === 'unlock') {
				expect(failed).toHaveBeenCalledWith('credential.unlock.failed', raw)
				expect(fetchAccounts).not.toHaveBeenCalled()
			} else expect(fetchAccounts).toHaveBeenCalledOnce()
			if (command === 'SYNC') {
				expect(persist).toHaveBeenCalledOnce()
				expect(persist.mock.calls[0]?.[0]).toMatchObject({
					counts,
					outcome: { lastOutcome: 'failed', lastError: 'operation-failed' }
				})
			} else expect(persist).not.toHaveBeenCalled()
			expect(imported).not.toHaveBeenCalled()
			expectCleanup(actor)
		}
	)

	it('retains the classified provider failure if recording its outcome also fails', async () => {
		vi.mocked(fetchAccounts).mockRejectedValueOnce(new Error('raw provider failure'))
		persist.mockRejectedValueOnce(new Error('raw storage failure'))
		const actor = start('SYNC')
		expect(await toPromise(actor)).toMatchObject({
			kind: 'failed',
			error: new Error('provider_failure')
		})
		expect(persist).toHaveBeenCalledOnce()
		expectCleanup(actor)
	})

	it.each(['DISCOVER', 'SYNC'] satisfies ('DISCOVER' | 'SYNC')[])(
		'preserves successful %s behavior',
		async (command) => {
			const actor = start(command)
			expect(await toPromise(actor)).toMatchObject({ kind: 'complete', counts })
			expect(unlockCredential).toHaveBeenCalledOnce()
			expect(fetchAccounts).toHaveBeenCalledExactlyOnceWith(
				'secret-access-url',
				command === 'DISCOVER',
				expect.any(AbortSignal),
				expect.objectContaining({ id: 'trace' })
			)
			if (command === 'SYNC') {
				expect(persist).toHaveBeenCalledOnce()
				expect(persist.mock.calls[0]?.[0].outcome).toEqual({
					lastOutcome: 'succeeded',
					lastError: null
				})
			} else {
				expect(actor.getSnapshot().output).toMatchObject({ discovered: [] })
				expect(persist).not.toHaveBeenCalled()
			}
			expect(failed).not.toHaveBeenCalled()
			expect(imported).toHaveBeenCalledTimes(command === 'SYNC' ? 1 : 0)
			expectCleanup(actor)
		}
	)

	it.each([
		{ stage: 'unlock', late: 'resolve' },
		{ stage: 'unlock', late: 'reject' },
		{ stage: 'fetch', late: 'resolve' },
		{ stage: 'fetch', late: 'reject' }
	])('cancels pending $stage and ignores late $late', async ({ stage, late }) => {
		const unlock = Promise.withResolvers<string>()
		const fetch = Promise.withResolvers<ProviderResponse>()
		let signal: AbortSignal | undefined
		if (stage === 'unlock')
			vi.mocked(unlockCredential).mockImplementationOnce((_envelope, _scope, received) => {
				signal = received
				return unlock.promise
			})
		else
			vi.mocked(fetchAccounts).mockImplementationOnce((_url, _discovery, received) => {
				signal = received
				return fetch.promise
			})
		const actor = start('SYNC')
		await waitFor(actor, (state) => state.matches(stage === 'unlock' ? 'unlocking' : 'fetching'))
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled', counts })
		expect(signal?.aborted).toBe(true)
		if (stage === 'unlock') {
			if (late === 'resolve') unlock.resolve('late-secret-url')
			else unlock.reject(new Error('late-secret-url'))
			await unlock.promise.catch(() => undefined)
		} else {
			if (late === 'resolve') fetch.resolve(response)
			else fetch.reject(new Error('late-secret-url'))
			await fetch.promise.catch(() => undefined)
		}
		await Promise.resolve()
		expect(actor.getSnapshot().matches('cancelled')).toBe(true)
		expect(persist).not.toHaveBeenCalled()
		expect(failed).not.toHaveBeenCalled()
		expect(fetchAccounts).toHaveBeenCalledTimes(stage === 'unlock' ? 0 : 1)
		expect(imported).not.toHaveBeenCalled()
		expectCleanup(actor)
	})
})

describe('discovery response recovery', () => {
	it('retains usable accounts from a mixed provider response without importing', async () => {
		vi.mocked(fetchAccounts).mockResolvedValueOnce({
			errors: ['One institution unavailable'],
			accounts: [
				{
					id: 'checking',
					name: 'Recovered Checking',
					currency: 'USD',
					org: { 'sfin-url': 'https://bank.example' }
				}
			]
		})
		const actor = start('DISCOVER')
		expect(await toPromise(actor)).toMatchObject({
			kind: 'partial',
			discovered: [{ id: 'checking', name: 'Recovered Checking', currency: 'USD' }]
		})
		expect(imported).not.toHaveBeenCalled()
		expect(persist).not.toHaveBeenCalled()
		expectCleanup(actor)
	})
	it('fails an errors-only discovery response', async () => {
		vi.mocked(fetchAccounts).mockResolvedValueOnce({
			errors: ['Provider unavailable'],
			accounts: []
		})
		const actor = start('DISCOVER')
		expect(await toPromise(actor)).toMatchObject({
			kind: 'failed',
			error: new Error('provider_failure')
		})
		expect(imported).not.toHaveBeenCalled()
		expect(persist).not.toHaveBeenCalled()
		expectCleanup(actor)
	})
})
