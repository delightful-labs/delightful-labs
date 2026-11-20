import { afterEach, expect, it, vi } from 'vitest'
import { createActor, waitFor, SimulatedClock } from 'xstate'
import {
	createApplicationReadinessMachine,
	selectApplicationView,
	selectLibraryActor,
	selectRecoveryBinding
} from './application-readiness.js'
import { nativeSessionFixture, readyAccount } from './session.test-support.js'
import type { AccountObservation, RootAccess } from '../../contracts/account.js'
import type { ConnectionObserver } from '../../contracts/connection.js'
import { controlledSave, testLibraryCapability } from '../capture/library.test-support.js'
import type { SaveResult } from '../../contracts/storage.js'

const cleanups = new Set<() => void>()
afterEach(() => {
	for (const dispose of cleanups) dispose()
	cleanups.clear()
	vi.restoreAllMocks()
})
function fixture(
	initial: AccountObservation = { status: 'signed-out', binding: {} },
	options?: {
		observeConnection?: ConnectionObserver
		clock?: SimulatedClock
		acquisition?: Promise<void>
		signOut?: () => Promise<void>
	}
) {
	const native = nativeSessionFixture(initial, options)
	const actor = createActor(createApplicationReadinessMachine(options?.observeConnection), {
		input: { ...native.input, ...(options?.signOut ? { signOut: options.signOut } : {}) },
		...(options?.clock ? { clock: options.clock } : {})
	})
	actor.start()
	native.owner.start()
	cleanups.add(() => {
		actor.stop()
		native.owner.stop()
	})
	return { ...native, actor }
}
async function ready(f: ReturnType<typeof fixture>) {
	await waitFor(f.actor, (snapshot) => !!selectLibraryActor(snapshot), { timeout: 1000 })
}
async function close(f: ReturnType<typeof fixture>) {
	f.actor.send({ type: 'SHUTDOWN' })
	await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
	expect(f.actor.getSnapshot().output).toEqual({ clean: true })
	expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('closed')
	// Application drain is separate from native session close, which the realm owns.
	expect(f.close).not.toHaveBeenCalled()
}
function root(local: Promise<void>, global: Promise<void>) {
	return {
		read: vi.fn<RootAccess['read']>(async () => 'missing'),
		ensure: vi.fn(() => ({ local: () => local, global: () => global }))
	} satisfies RootAccess
}
it('opens an existing local library without a write or remote-acceptance claim', async () => {
	const ensure = vi.fn(),
		f = fixture(readyAccount('A', { read: async () => 'compatible', ensure }))
	await ready(f)
	expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('ready')
	expect(ensure).not.toHaveBeenCalled()
	await close(f)
})
it('withholds library/root access until the native local-first observation is ready', async () => {
	const read = vi.fn<RootAccess['read']>(async () => 'compatible'),
		value = readyAccount('A', { read, ensure: vi.fn() })
	const f = fixture({ ...value, localFirst: false })
	await waitFor(f.owner, (s) => s.context.observation?.status === 'ready')
	expect(selectLibraryActor(f.actor.getSnapshot())).toBeUndefined()
	expect(read).not.toHaveBeenCalled()
	f.emit(value)
	await ready(f)
	expect(read).toHaveBeenCalledOnce()
})
it('withdraws native preparation observations on shutdown without allocating a library', async () => {
	const value = readyAccount(),
		f = fixture({ ...value, localFirst: false })
	await waitFor(f.owner, (s) => s.context.observation?.status === 'ready')
	await close(f)
	f.emit(value)
	expect(value.capabilities.createLibrary).not.toHaveBeenCalled()
})
it('uses the latest binding when an earlier thin/native preparation is superseded', async () => {
	const a = readyAccount('A'),
		b = readyAccount('B'),
		f = fixture({ ...a, localFirst: false })
	await waitFor(f.owner, (s) => s.context.observation?.status === 'ready')
	f.emit({ status: 'transitioning' })
	f.emit(b)
	await ready(f)
	expect(f.actor.getSnapshot().context.observation).toBe(b)
	expect(a.capabilities.createLibrary).not.toHaveBeenCalled()
})
it('does not publish local-saved or synced while a root write is locally pending', async () => {
	const local = Promise.withResolvers<void>(),
		global = Promise.withResolvers<void>()
	const access = root(local.promise, global.promise),
		f = fixture(readyAccount('A', access))
	await vi.waitFor(() => expect(access.ensure).toHaveBeenCalledOnce())
	expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('openingLibrary')
	expect(selectLibraryActor(f.actor.getSnapshot())).toBeUndefined()
	local.resolve()
	await ready(f)
	expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('localSaved')
	global.resolve()
	await vi.waitFor(() =>
		expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('synced')
	)
})
it('retains an issued root receipt through shutdown and releases the library lease after local settlement', async () => {
	const local = Promise.withResolvers<void>(),
		access = root(local.promise, Promise.resolve())
	const value = readyAccount('A', access),
		live: (() => boolean)[] = []
	const create = value.capabilities.createLibrary
	const f = fixture({
		...value,
		capabilities: {
			...value.capabilities,
			createLibrary: (current) => {
				live.push(current)
				return create(current)
			}
		}
	})
	await vi.waitFor(() => expect(access.ensure).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(live[0]?.()).toBe(true)
	local.resolve()
	await waitFor(f.actor, (s) => s.status === 'done')
	expect(live[0]?.()).toBe(false)
	expect(f.close).not.toHaveBeenCalled()
})
it('does not overwrite an incompatible library root', async () => {
	const ensure = vi.fn(),
		f = fixture(readyAccount('A', { read: async () => 'incompatible', ensure }))
	await vi.waitFor(() =>
		expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('conflict')
	)
	expect(ensure).not.toHaveBeenCalled()
	expect(selectLibraryActor(f.actor.getSnapshot())).toBeUndefined()
	await close(f)
})
it('exposes recovery only for the ready library and withdraws it before shutdown completes', async () => {
	const f = fixture(readyAccount())
	await ready(f)
	expect(selectRecoveryBinding(f.actor.getSnapshot())).toBeDefined()
	f.actor.send({ type: 'SHUTDOWN' })
	expect(selectRecoveryBinding(f.actor.getSnapshot())).toBeUndefined()
})
it.each(['device', 'backend'] satisfies ('device' | 'backend')[])(
	'offers sign-out only for deliberate %s identities',
	async (identityKind) => {
		const f = fixture({ ...readyAccount(), identityKind })
		await ready(f)
		expect(selectApplicationView(f.actor.getSnapshot(), true).canLogout).toBe(
			identityKind === 'backend'
		)
	}
)
it('creates identity through the shared owner with captured signed-out admission', async () => {
	const f = fixture()
	await waitFor(f.actor, (s) => s.context.observation.status === 'signed-out')
	f.change.mockImplementation(async () => {
		f.emit(readyAccount())
		return 'completed'
	})
	f.actor.send({ type: 'CREATE' })
	await ready(f)
	expect(f.change).toHaveBeenCalledWith(
		expect.objectContaining({
			operation: 'create',
			before: expect.objectContaining({ status: 'signed-out' })
		})
	)
})
it('clears an invalid restoration phrase without issuing a native mutation', async () => {
	const f = fixture()
	await waitFor(f.actor, (s) => s.context.observation.status === 'signed-out')
	f.actor.send({ type: 'RESTORE', phrase: 'invalid synthetic phrase' })
	await vi.waitFor(() =>
		expect(selectApplicationView(f.actor.getSnapshot(), true).feedback).toBe('restoreInvalid')
	)
	expect(f.actor.getSnapshot().context.phrase).toBe('')
	expect(f.change).not.toHaveBeenCalled()
})
it('restores through the existing session-change protocol and clears sensitive input', async () => {
	const f = fixture()
	await waitFor(f.actor, (s) => s.context.observation.status === 'signed-out')
	f.change.mockImplementation(async () => {
		f.emit(readyAccount('restored'))
		return 'completed'
	})
	f.actor.send({ type: 'RESTORE', phrase: 'valid synthetic phrase' })
	await ready(f)
	expect(f.change).toHaveBeenCalledWith(
		expect.objectContaining({ operation: 'restore', credential: 'synthetic-secret' })
	)
	expect(f.actor.getSnapshot().context.phrase).toBe('')
})
it.each(['CREATE', 'RESTORE'] satisfies ('CREATE' | 'RESTORE')[])(
	'retains an issued %s call through shutdown and ignores late readiness for admission',
	async (type) => {
		const pending = Promise.withResolvers<void>(),
			f = fixture()
		await waitFor(f.actor, (s) => s.context.observation.status === 'signed-out')
		f.change.mockImplementation(async () => {
			await pending.promise
			f.emit(readyAccount('late'))
			return 'completed'
		})
		if (type === 'CREATE') f.actor.send({ type })
		else f.actor.send({ type, phrase: 'valid synthetic phrase' })
		await vi.waitFor(() => expect(f.change).toHaveBeenCalledOnce())
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.actor.getSnapshot().context.phrase).toBe('')
		pending.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(selectLibraryActor(f.actor.getSnapshot())).toBeUndefined()
	}
)
it.each(['provider', 'session'] satisfies ('provider' | 'session')[])(
	'retains the issued %s sign-out effect during overdue feedback and shutdown',
	async (stage) => {
		const pending = Promise.withResolvers<void>(),
			clock = new SimulatedClock()
		const provider = vi.fn(async () => {
			if (stage === 'provider') await pending.promise
		})
		const f = fixture(readyAccount(), { signOut: provider, clock })
		await ready(f)
		f.change.mockImplementation(async () => {
			if (stage === 'session') await pending.promise
			f.emit({ status: 'signed-out', binding: {} })
			return 'completed'
		})
		f.actor.send({ type: 'LOGOUT' })
		await vi.waitFor(() =>
			expect(stage === 'provider' ? provider : f.change).toHaveBeenCalledOnce()
		)
		clock.increment(30_000)
		expect(selectApplicationView(f.actor.getSnapshot(), true).requiresReload).toBe(true)
		f.actor.send({ type: 'SHUTDOWN' })
		clock.increment(30_000)
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.close).not.toHaveBeenCalled()
		if (stage === 'provider') expect(f.change).not.toHaveBeenCalled()
		pending.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.change).toHaveBeenCalledOnce()
	}
)
it('does not clear a replacement account when a delayed provider sign-out settles', async () => {
	const pending = Promise.withResolvers<void>(),
		f = fixture(readyAccount('A'), { signOut: () => pending.promise })
	await ready(f)
	f.actor.send({ type: 'LOGOUT' })
	await waitFor(f.actor, (s) => s.matches({ active: { flow: { running: 'loggingOut' } } }))
	const b = readyAccount('B')
	f.emit(b)
	pending.resolve()
	await ready(f)
	expect(f.change).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().context.observation).toBe(b)
})
it('does not sign a new local identity out after the provider already cleared backend identity', async () => {
	const pending = Promise.withResolvers<void>(),
		f = fixture(readyAccount('A'), { signOut: () => pending.promise })
	await ready(f)
	f.actor.send({ type: 'LOGOUT' })
	await waitFor(f.actor, (s) => s.matches({ active: { flow: { running: 'loggingOut' } } }))
	f.emit({ ...readyAccount('device'), identityKind: 'device' })
	pending.resolve()
	await ready(f)
	expect(f.change).not.toHaveBeenCalled()
})
it('refreshes facts after provider refusal without automatic retry or native logout', async () => {
	const provider = vi.fn(async () => {
			throw new Error('Provider refused')
		}),
		f = fixture(readyAccount(), { signOut: provider })
	await ready(f)
	f.actor.send({ type: 'LOGOUT' })
	await vi.waitFor(() =>
		expect(selectApplicationView(f.actor.getSnapshot(), true).feedback).toBe('identityFailed')
	)
	await ready(f)
	expect(provider).toHaveBeenCalledOnce()
	expect(f.change).not.toHaveBeenCalled()
})
it('allocates once for duplicate native observations and revokes the lease on forced stop', async () => {
	const value = readyAccount(),
		live: (() => boolean)[] = [],
		create = value.capabilities.createLibrary
	const f = fixture({
		...value,
		capabilities: {
			...value.capabilities,
			createLibrary: (current) => {
				live.push(current)
				return create(current)
			}
		}
	})
	await ready(f)
	const library = selectLibraryActor(f.actor.getSnapshot())
	for (let index = 0; index < 4; index++) f.emit({ ...f.current() })
	expect(selectLibraryActor(f.actor.getSnapshot())).toBe(library)
	expect(live).toHaveLength(1)
	f.actor.stop()
	expect(live[0]?.()).toBe(false)
})
it('adopts only C after A → B → C while an issued A write drains, retaining its unknown outcome', async () => {
	const pending = Promise.withResolvers<SaveResult>(),
		issued = vi.fn(() => pending.promise),
		save = controlledSave(issued),
		id = crypto.randomUUID()
	const a = readyAccount('A'),
		b = readyAccount('B'),
		c = readyAccount('C')
	const capability = testLibraryCapability(
		{
			id,
			title: 'A',
			text: '',
			html: '',
			submittedUrl: 'https://example.com/',
			finalUrl: 'https://example.com/',
			provenance: '{}',
			imagesMissing: false
		},
		{ spawnSave: (spawn, request) => spawn(save, { input: request }) }
	)
	const f = fixture({ ...a, capabilities: { ...a.capabilities, createLibrary: () => capability } })
	await ready(f)
	const library = selectLibraryActor(f.actor.getSnapshot())
	library?.send({ type: 'ADD', url: 'https://example.com/' })
	await vi.waitFor(() => expect(issued).toHaveBeenCalledOnce())
	f.emit(b)
	f.emit(c)
	expect(selectLibraryActor(f.actor.getSnapshot())).toBeUndefined()
	expect(b.capabilities.createLibrary).not.toHaveBeenCalled()
	expect(c.capabilities.createLibrary).not.toHaveBeenCalled()
	pending.resolve({ kind: 'unknown', operationId: id })
	await ready(f)
	expect(issued).toHaveBeenCalledOnce()
	expect(b.capabilities.createLibrary).not.toHaveBeenCalled()
	expect(c.capabilities.createLibrary).toHaveBeenCalledOnce()
})
it('latches failed domain construction until explicit retry and never loops on duplicate native facts', async () => {
	const value = readyAccount(),
		create = vi.fn(value.capabilities.createLibrary)
	create.mockImplementationOnce(() => {
		throw new Error('Domain construction refused')
	})
	const f = fixture({ ...value, capabilities: { ...value.capabilities, createLibrary: create } })
	await vi.waitFor(() =>
		expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('unavailable')
	)
	for (let index = 0; index < 4; index++) f.emit(f.current())
	expect(create).toHaveBeenCalledOnce()
	f.actor.send({ type: 'RETRY' })
	await ready(f)
	expect(create).toHaveBeenCalledTimes(2)
})
it('retries a failed native acquisition through the same shared owner', async () => {
	const acquisition = Promise.withResolvers<void>(),
		f = fixture(undefined, { acquisition: acquisition.promise })
	acquisition.reject(new Error('Native open failed'))
	await vi.waitFor(() =>
		expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('unavailable')
	)
	f.open.mockResolvedValue(f.resource)
	f.actor.send({ type: 'RETRY' })
	await waitFor(f.actor, (s) => s.context.observation.status === 'signed-out')
	expect(f.open).toHaveBeenCalledTimes(2)
})
it('reobserves native subscription failure through the shared runtime', async () => {
	const f = fixture(readyAccount())
	await ready(f)
	f.failObservation()
	await vi.waitFor(() =>
		expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('unavailable')
	)
	expect(selectLibraryActor(f.actor.getSnapshot())).toBeUndefined()
	f.actor.send({ type: 'RETRY' })
	await ready(f)
	expect(f.dispose).toHaveBeenCalledOnce()
})
it('retains an issued root receipt after unexpected session failure and refuses a clean drain result', async () => {
	const local = Promise.withResolvers<void>(),
		access = root(local.promise, Promise.resolve()),
		f = fixture(readyAccount('A', access))
	await vi.waitFor(() => expect(access.ensure).toHaveBeenCalledOnce())
	f.owner.stop()
	expect(f.actor.getSnapshot().status).toBe('active')
	local.resolve()
	await waitFor(f.actor, (s) => s.status === 'done')
	expect(f.actor.getSnapshot().output).toEqual({ clean: false })
	expect(selectApplicationView(f.actor.getSnapshot(), true).status).toBe('ownerFailed')
})
it('tracks connectivity independently and releases observation immediately while a root receipt drains', async () => {
	const local = Promise.withResolvers<void>(),
		access = root(local.promise, Promise.resolve()),
		release = vi.fn()
	const f = fixture(readyAccount('A', access), {
		observeConnection: (report) => {
			report({ type: 'OFFLINE' })
			return release
		}
	})
	await vi.waitFor(() => expect(access.ensure).toHaveBeenCalledOnce())
	expect(selectApplicationView(f.actor.getSnapshot(), true).connectionMessage).toBeDefined()
	f.actor.send({ type: 'SHUTDOWN' })
	expect(release).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().status).toBe('active')
	local.resolve()
	await waitFor(f.actor, (s) => s.status === 'done')
})
