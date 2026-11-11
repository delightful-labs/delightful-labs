import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as passkeys from '#lib/integrations/passkey.js'
import * as provider from '#lib/integrations/simplefin.js'
import { createBankTrace } from '#lib/integrations/diagnostics.js'
import { createBankSetupMachine } from './setup.js'
import type { Dependencies, LockEvent } from './types.js'
import type { bankLock } from './lock.js'
import type { createPreparationMachine } from './preparation.js'
import type { createSetupPersistenceMachine } from './setup-persist.js'
import {
	createActor,
	createMachine,
	createCallbackLogic,
	setup,
	toPromise,
	waitFor,
	types,
	createAsyncLogic
} from 'xstate'
import type { ActorFromLogic, InputFrom, OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

vi.mock('#lib/integrations/passkey.js', () => ({
	createPasskey: vi.fn(),
	encryptPasskeySample: vi.fn(),
	verifyPasskeySample: vi.fn()
}))
vi.mock('#lib/integrations/simplefin.js', () => ({
	validateSetupToken: vi.fn(),
	claimToken: vi.fn(),
	simplefinDemo: false
}))
vi.mock('#lib/integrations/diagnostics.js', () => ({ createBankTrace: vi.fn() }))

// Keep real setup effect actors; isolate authorization and database children.
vi.mock('./preparation.js', () => ({
	createPreparationMachine: () =>
		success({ ok: true, value: { scope, connection: undefined } } satisfies OutputFrom<
			ReturnType<typeof createPreparationMachine>
		>)
}))
vi.mock('./authorization.js', () => ({
	createAuthorizationMachine: () => success({ error: undefined })
}))
vi.mock('./setup-baseline.js', () => ({
	createSetupBaselineMachine: () => success({ error: undefined })
}))
vi.mock('./setup-persist.js', () => ({
	createSetupPersistenceMachine: () => {
		const save = createAsyncLogic<PersistOutput, PersistInput>({ run: persist })
		const events0 = { SAVE: types<EventPayload<{ type: 'SAVE' }, 'SAVE'>>() }
		type NativeEvent0 =
			| import('xstate').InferEvents<typeof events0>
			| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof save>>
			| import('xstate').ErrorActorEvent
		return setup({
			schemas: {
				context: types<{ input: PersistInput; result: PersistOutput | undefined }>(),
				events: events0,
				input: types<PersistInput>(),
				output: types<PersistOutput>(),
				children: { save: types<import('xstate').ActorFromLogic<{ save: typeof save }['save']>>() }
			},
			actors: { save }
		}).createMachine({
			context: ({ input }) => ({ input, result: undefined }),
			initial: 'saving',
			states: {
				saving: {
					invoke: {
						src: 'save',
						input: ({ context }) => context.input,
						onDone: (args) => {
							return { target: 'complete', context: { result: args.event.output } }
						}
					}
				},
				complete: { type: 'final' }
			},
			output: ({ context }) => {
				if (!context.result) throw new Error('missing persistence result')
				return context.result
			}
		})
	}
}))
function success<T>(output: T) {
	return createMachine({
		initial: 'complete',
		states: { complete: { type: 'final' } },
		output: () => output
	})
}
type PersistOutput = OutputFrom<ReturnType<typeof createSetupPersistenceMachine>>
type PersistInput = InputFrom<ReturnType<typeof createSetupPersistenceMachine>>
type SetupActor = ActorFromLogic<ReturnType<typeof createBankSetupMachine>>

const scope = { ownerId: 'owner', organizationId: 'organization', connectionId: 'connection' }
const descriptor = { credentialId: 'credential', prfSalt: 'salt' }
const sample = { passkey: descriptor, iv: new Uint8Array(12), ciphertext: new ArrayBuffer(16) }
const envelope = {
	version: 1,
	...scope,
	credentialId: 'credential',
	prfSalt: 'salt',
	iv: 'iv',
	ciphertext: 'encrypted'
} satisfies Awaited<ReturnType<passkeys.CredentialSealer>>
const seal = vi.fn<passkeys.CredentialSealer>()
const failed = vi.fn()
const releaseLock = vi.fn()
const acquireLock = vi.fn<() => void>()
const persist = vi.fn<({ input }: { input: PersistInput }) => Promise<PersistOutput>>()
const actors: SetupActor[] = []

function start(): SetupActor {
	// Database-bound children are replaced below; no Jazz runtime is opened.
	const db = vi.fn<() => Dependencies['db']>()()
	const machine = createBankSetupMachine({
		db,
		observe: () => ({
			...scope,
			userId: scope.ownerId,
			allowed: true,
			connected: false,
			sessionReady: true,
			connection: undefined
		}),
		passkeyName: () => 'Test'
	}).provide({
		actors: {
			lock: createCallbackLogic<LockEvent, InputFrom<typeof bankLock>>(({ sendBack }) => {
				acquireLock()
				sendBack({ type: 'LOCK_ACQUIRED' })
				return releaseLock
			})
		}
	})
	const actor = createActor(machine, { input: { token: 'source-token' } }).start()
	actors.push(actor)
	return actor
}

async function advance(actor: ReturnType<typeof start>) {
	await waitFor(actor, (state) => state.matches('readyToEncrypt') || state.status === 'done')
	if (actor.getSnapshot().status === 'done') return
	actor.send({ type: 'TEST_ENCRYPTION' })
	await waitFor(actor, (state) => state.matches('readyToVerify') || state.status === 'done')
	if (actor.getSnapshot().status === 'done') return
	actor.send({ type: 'VERIFY_DECRYPTION' })
	await waitFor(actor, (state) => state.matches('readyToSave') || state.status === 'done')
	if (actor.getSnapshot().status === 'done') return
	actor.send({ type: 'SAVE_CONNECTION' })
}

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(createBankTrace).mockReturnValue({
		id: 'trace',
		log: vi.fn(),
		failed,
		step: async (_stage, work) => work()
	})
	vi.mocked(provider.validateSetupToken).mockResolvedValue('claim-url')
	vi.mocked(passkeys.createPasskey).mockResolvedValue(descriptor)
	vi.mocked(passkeys.encryptPasskeySample).mockResolvedValue(sample)
	vi.mocked(passkeys.verifyPasskeySample).mockResolvedValue(seal)
	vi.mocked(provider.claimToken).mockResolvedValue('secret-access-url')
	seal.mockResolvedValue(envelope)
	persist.mockResolvedValue({ settlement: 'locallyPersisted', error: undefined })
})
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})

describe('setup actor failure boundaries', () => {
	it.each([
		{ stage: 'creation', acquisition: 1 },
		{ stage: 'encryption', acquisition: 2 },
		{ stage: 'verification', acquisition: 3 },
		{ stage: 'saving', acquisition: 4 }
	])('handles a lock actor throwing before $stage acquisition', async ({ acquisition }) => {
		acquireLock.mockImplementation(() => {
			if (acquireLock.mock.calls.length === acquisition) throw new Error('locking_unavailable')
		})
		const actor = start()
		await advance(actor)
		expect(await toPromise(actor)).toEqual({
			kind: 'failed',
			error: new Error('locking_unavailable'),
			settlement: 'notStarted'
		})
		expect(actor.getSnapshot().context).toMatchObject({
			token: undefined,
			accessUrl: undefined,
			base: undefined,
			material: undefined
		})
		expect(acquireLock).toHaveBeenCalledTimes(acquisition)
		// Only previously acquired locks have a disposer; the failed actor acquired nothing.
		expect(releaseLock).toHaveBeenCalledTimes(acquisition - 1)
		expect(passkeys.createPasskey).toHaveBeenCalledTimes(acquisition > 1 ? 1 : 0)
		expect(passkeys.encryptPasskeySample).toHaveBeenCalledTimes(acquisition > 2 ? 1 : 0)
		expect(passkeys.verifyPasskeySample).toHaveBeenCalledTimes(acquisition > 3 ? 1 : 0)
		expect(provider.claimToken).not.toHaveBeenCalled()
		expect(seal).not.toHaveBeenCalled()
		expect(persist).not.toHaveBeenCalled()
	})

	it.each([
		{
			stage: 'token',
			effect: () => vi.mocked(provider.validateSetupToken),
			code: 'invalid_setup_token'
		},
		{ stage: 'creation', effect: () => vi.mocked(passkeys.createPasskey), code: 'passkey_failure' },
		{
			stage: 'encryption',
			effect: () => vi.mocked(passkeys.encryptPasskeySample),
			code: 'passkey_failure'
		},
		{
			stage: 'verification',
			effect: () => vi.mocked(passkeys.verifyPasskeySample),
			code: 'passkey_failure'
		},
		{ stage: 'claim', effect: () => vi.mocked(provider.claimToken), code: 'claim_failure' },
		{ stage: 'sealing', effect: () => seal, code: 'save_failure' }
	])(
		'classifies $stage failures in the transition and clears transient material',
		async ({ effect, code }) => {
			const raw = new Error('unsafe provider details: source-token secret-access-url')
			effect().mockRejectedValueOnce(raw)
			const actor = start()
			await advance(actor)
			const result = await toPromise(actor)
			expect(result).toEqual({ kind: 'failed', error: new Error(code), settlement: 'notStarted' })
			expect(actor.getSnapshot().context).toMatchObject({
				token: undefined,
				accessUrl: undefined,
				base: undefined,
				material: undefined
			})
			expect(failed).toHaveBeenCalledExactlyOnceWith('setup.failed', new Error(code))
			expect(failed).not.toHaveBeenCalledWith('setup.failed', raw)
			expect(releaseLock).toHaveBeenCalled()
			expect(persist).not.toHaveBeenCalled()
			expect(JSON.stringify(result)).not.toContain('secret-access-url')
		}
	)

	it('continues through all explicit steps and persists only the encrypted envelope', async () => {
		const actor = start()
		await advance(actor)
		expect(await toPromise(actor)).toEqual({ kind: 'complete' })
		expect(persist).toHaveBeenCalledOnce()
		expect(persist.mock.calls[0]?.[0]).toMatchObject({ input: { scope, encrypted: envelope } })
		expect(failed).not.toHaveBeenCalled()
		expect(releaseLock).toHaveBeenCalledTimes(4)
		expect(actor.getSnapshot().context).toMatchObject({
			token: undefined,
			accessUrl: undefined,
			material: undefined,
			base: undefined
		})
	})

	it('cancels pending encryption and ignores its late rejection', async () => {
		const pending = Promise.withResolvers<passkeys.PasskeySample>()
		let signal: AbortSignal | undefined
		vi.mocked(passkeys.encryptPasskeySample).mockImplementationOnce(
			(_scope, _passkey, received) => {
				signal = received
				return pending.promise
			}
		)
		const actor = start()
		await waitFor(actor, (state) => state.matches('readyToEncrypt'))
		actor.send({ type: 'TEST_ENCRYPTION' })
		await waitFor(actor, (state) => state.matches({ encrypting: 'encryptingSample' }))
		actor.send({ type: 'CANCEL' })
		expect(await toPromise(actor)).toEqual({ kind: 'cancelled', settlement: 'notStarted' })
		expect(signal?.aborted).toBe(true)
		pending.reject(new Error('late secret-access-url'))
		await pending.promise.catch(() => undefined)
		await Promise.resolve()
		expect(actor.getSnapshot().matches('cancelled')).toBe(true)
		expect(failed).not.toHaveBeenCalled()
		expect(passkeys.verifyPasskeySample).not.toHaveBeenCalled()
		expect(provider.claimToken).not.toHaveBeenCalled()
		expect(persist).not.toHaveBeenCalled()
		expect(releaseLock).toHaveBeenCalledTimes(2)
		expect(actor.getSnapshot().context).toMatchObject({
			token: undefined,
			accessUrl: undefined,
			material: undefined,
			base: undefined
		})
	})
})

describe('setup persistence settlement', () => {
	it.each(['locallyPersisted', 'unresolved'] satisfies PersistOutput['settlement'][])(
		'holds the lock through cancellation until %s settlement',
		async (settlement) => {
			const pending = Promise.withResolvers<PersistOutput>()
			persist.mockReturnValueOnce(pending.promise)
			const actor = start()
			await advance(actor)
			await waitFor(actor, (state) => state.matches({ saving: { persisting: 'working' } }))
			actor.send({ type: 'CANCEL' })
			actor.send({ type: 'LOCK_FAILED', error: new Error('late lock failure') })
			actor.send({ type: 'CANCEL' })
			actor.send({ type: 'SAVE_CONNECTION' })
			expect(actor.getSnapshot().matches({ saving: { persisting: 'draining' } })).toBe(true)
			expect(actor.getSnapshot().status).toBe('active')
			expect(releaseLock).toHaveBeenCalledTimes(3)
			expect(persist).toHaveBeenCalledOnce()
			expect(actor.getSnapshot().context).toMatchObject({
				token: undefined,
				accessUrl: undefined,
				base: undefined,
				material: undefined
			})
			pending.resolve(
				settlement === 'locallyPersisted'
					? { settlement, error: undefined }
					: { settlement, error: new Error('save_failure') }
			)
			expect(await toPromise(actor)).toEqual({ kind: 'cancelled', settlement })
			expect(releaseLock).toHaveBeenCalledTimes(4)
			expect(provider.claimToken).toHaveBeenCalledOnce()
		}
	)
	it('waits for a write after lock failure and preserves failure despite successful settlement', async () => {
		const pending = Promise.withResolvers<PersistOutput>()
		persist.mockReturnValueOnce(pending.promise)
		const actor = start()
		await advance(actor)
		await waitFor(actor, (state) => state.matches({ saving: { persisting: 'working' } }))
		actor.send({ type: 'LOCK_FAILED', error: new Error('locking_unavailable') })
		expect(actor.getSnapshot().matches({ saving: { persisting: 'failing' } })).toBe(true)
		expect(releaseLock).toHaveBeenCalledTimes(3)
		pending.resolve({ settlement: 'locallyPersisted', error: undefined })
		expect(await toPromise(actor)).toEqual({
			kind: 'failed',
			error: new Error('locking_unavailable'),
			settlement: 'locallyPersisted'
		})
		expect(releaseLock).toHaveBeenCalledTimes(4)
	})
	it('finishes cancellation when the persistence actor crashes without waiting for another acknowledgement', async () => {
		const pending = Promise.withResolvers<PersistOutput>()
		persist.mockReturnValueOnce(pending.promise)
		const actor = start()
		await advance(actor)
		await waitFor(actor, (state) => state.matches({ saving: { persisting: 'working' } }))
		actor.send({ type: 'CANCEL' })
		pending.reject(new Error('write observer crashed'))
		expect(await toPromise(actor)).toEqual({ kind: 'cancelled', settlement: 'unresolved' })
		expect(releaseLock).toHaveBeenCalledTimes(4)
	})
})
