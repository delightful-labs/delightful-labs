import { afterEach, expect, it, vi } from 'vitest'
import { SimulatedClock, waitFor } from 'xstate'
import type { AccountObservation } from '../../contracts/account.js'
import { nativeSessionFixture, readyAccount } from '../../machines/runtime/session.test-support.js'
import {
	testLibraryCapability,
	controlledSave
} from '../../machines/capture/library.test-support.js'
import type { LibraryCapability } from '../../contracts/library.js'
import type { SaveResult } from '../../contracts/storage.js'
import { createWorkerHostFixture } from './host-machine.test-support.js'
import { selectApplicationView } from '../../machines/runtime/application-readiness.js'

const cleanups = new Set<() => void>()

it.each(['provider', 'session'] as const)(
	'retains the %s sign-out effect during overdue feedback and actual realm shutdown',
	async (stage) => {
		const native = fixture(),
			pending = Promise.withResolvers<void>(),
			clock = new SimulatedClock()
		const provider = vi.fn(() => (stage === 'provider' ? pending.promise : Promise.resolve()))
		const session = vi.fn(async () => {
			if (stage === 'session') await pending.promise
			native.emit({ status: 'signed-out', binding: {} })
		})
		const observation = native.current()
		if (observation.status !== 'ready') throw new Error('Missing native identity')
		native.account.change.mockImplementation(async () => {
			await session()
			return 'completed'
		})
		const f = createWorkerHostFixture(undefined, undefined, undefined, {
			account: native.account,
			signOut: provider,
			clock,
			closePolicy: { drainMs: 5 }
		})
		try {
			f.actor.start()
			await waitFor(f.actor, (snapshot) => !!snapshot.context.library, { timeout: 1000 })
			f.actor.send({
				type: 'ACCOUNT',
				scope: f.actor.getSnapshot().context.scope,
				event: { type: 'LOGOUT' }
			})
			await vi.waitFor(() =>
				expect(stage === 'provider' ? provider : session).toHaveBeenCalledOnce()
			)
			const application = f.actor.getSnapshot().children.application!,
				owner = application.getSnapshot().children.logout
			clock.increment(30_000)
			expect(selectApplicationView(application.getSnapshot(), true).requiresReload).toBe(true)
			f.actor.send({ type: 'SHUTDOWN' })
			clock.increment(5)
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.close).not.toHaveBeenCalled()
			expect(application.getSnapshot().children.logout).toBe(owner)
			if (stage === 'provider') expect(session).not.toHaveBeenCalled()
			pending.resolve()
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
			expect(f.close).toHaveBeenCalledOnce()
			expect(provider).toHaveBeenCalledOnce()
			expect(session).toHaveBeenCalledOnce()
		} finally {
			pending.resolve()
			f.actor.stop()
			f.owner.stop()
		}
	}
)
afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups.clear()
	vi.restoreAllMocks()
})
function fixture() {
	const releaseRecovery = vi.fn(),
		observeRecovery = vi.fn()
	const libraries = new Map<string, LibraryCapability>(),
		live: (() => boolean)[] = []
	const adopt = vi.fn(
		(value: Extract<AccountObservation, { status: 'ready' }>, isLive: () => boolean) => {
			live.push(isLive)
			return (
				libraries.get(value.identityId) ??
				testLibraryCapability({
					id: crypto.randomUUID(),
					title: value.identityId,
					text: 'local',
					html: '<p>local</p>',
					submittedUrl: 'https://example.com/',
					finalUrl: 'https://example.com/',
					provenance: '{}',
					imagesMissing: false
				})
			)
		}
	)
	const native = (identityId: string) => {
		const base = readyAccount(identityId)
		const value: Extract<AccountObservation, { status: 'ready' }> = {
			...base,
			capabilities: {
				...base.capabilities,
				recovery: {
					...base.capabilities.recovery,
					source: {
						subscribe: (notify) => {
							observeRecovery(identityId)
							notify({ kind: 'unavailable' })
							return () => releaseRecovery(identityId)
						}
					}
				},
				createLibrary: (isLive) => adopt(value, isLive)
			}
		}
		return value
	}
	const source = nativeSessionFixture(native('A'))
	return {
		...source,
		account: source,
		native,
		adopt,
		live,
		libraries,
		observeRecovery,
		releaseRecovery
	}
}
it('owns one recovery/tag/subscription set for duplicate native binding observations', async () => {
	const native = fixture(),
		f = createWorkerHostFixture(undefined, undefined, undefined, { account: native.account })
	cleanups.add(() => {
		f.actor.stop()
		f.owner.stop()
	})
	f.actor.start()
	await waitFor(f.actor, (s) => !!s.context.library && !!s.context.recovery, { timeout: 1000 })
	const before = f.actor.getSnapshot().context
	for (let index = 0; index < 4; index++) native.emit({ ...native.current() })
	await vi.waitFor(() => expect(f.actor.getSnapshot().context.library).toBe(before.library))
	expect(f.actor.getSnapshot().context.scope).toBe(before.scope)
	expect(f.actor.getSnapshot().context.tagForm).toBe(before.tagForm)
	expect(f.actor.getSnapshot().context.recovery).toBe(before.recovery)
	expect(native.adopt).toHaveBeenCalledOnce()
	expect(native.observeRecovery).toHaveBeenCalledExactlyOnceWith('A')
	f.actor.send({ type: 'SHUTDOWN' })
	await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
	expect(native.releaseRecovery).toHaveBeenCalledExactlyOnceWith('A')
	expect(native.live[0]?.()).toBe(false)
})
it('A → B → C retires Window resources before publishing the latest binding and refuses stale scope/facts', async () => {
	const native = fixture(),
		f = createWorkerHostFixture(undefined, undefined, undefined, { account: native.account })
	const port = new MessageChannel(),
		commands: { type: string; id?: string }[] = []
	port.port1.onmessage = (event) => commands.push(event.data)
	cleanups.add(() => {
		f.actor.stop()
		f.owner.stop()
		port.port1.close()
	})
	f.actor.start()
	await waitFor(f.actor, (s) => !!s.context.library, { timeout: 1000 })
	const a = f.actor.getSnapshot().context
	// Refused/unopened surfaces still own native listeners and need real cleanup.
	f.actor.send({
		type: 'ATTACH_BOUND',
		scope: a.scope,
		documentId: crypto.randomUUID(),
		sources: [],
		port: port.port2,
		fullscreen: { supported: false, active: false }
	})
	await vi.waitFor(() => expect(commands.some((command) => command.type === 'DISPOSE')).toBe(true))
	native.emit(native.native('B'))
	native.emit(native.native('C'))
	await waitFor(f.actor, (s) => s.matches({ running: { accepting: 'retiring' } }), {
		timeout: 1000
	})
	await vi.waitFor(() => expect(native.adopt.mock.calls.at(-1)?.[0].identityId).toBe('C'))
	expect(f.actor.getSnapshot().context.library).toBeUndefined()
	f.actor.send({ type: 'MORE', scope: a.scope })
	expect(f.actor.getSnapshot().context.limit).toBe(50)
	const id = commands.find((command) => command.type === 'DISPOSE')?.id
	if (!id) throw new Error('Missing native cleanup identity')
	port.port1.postMessage({ type: 'DISPOSED', id })
	await waitFor(f.actor, (s) => !!s.context.library && s.context.scope !== a.scope, {
		timeout: 1000
	})
	const c = f.actor.getSnapshot().context
	f.actor.send({ type: 'MORE', scope: a.scope })
	expect(f.actor.getSnapshot().context.limit).toBe(50)
	if (!c.library) throw new Error('Missing C library')
	f.actor.send({
		type: 'LIBRARY_OBSERVED',
		generation: a.bindingGeneration,
		facts: { library: c.library, active: false, documentId: undefined, tags: {} }
	})
	expect(f.actor.getSnapshot().context.facts?.active).toBe(true)
	expect(native.observeRecovery.mock.calls.map(([id]) => id)).toEqual(['A', 'C'])
	expect(native.releaseRecovery).toHaveBeenCalledExactlyOnceWith('A')
})
it('reports an overdue domain drain without closing the SDK or abandoning the original issued write', async () => {
	const native = fixture(),
		clock = new SimulatedClock(),
		pending = Promise.withResolvers<SaveResult>()
	const issued = vi.fn(() => pending.promise),
		save = controlledSave(issued),
		id = crypto.randomUUID()
	native.libraries.set(
		'A',
		testLibraryCapability(
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
	)
	const f = createWorkerHostFixture(undefined, undefined, undefined, {
		account: native.account,
		clock,
		closePolicy: { drainMs: 5 }
	})
	cleanups.add(() => {
		pending.resolve({ kind: 'unknown', operationId: id })
		f.actor.stop()
		f.owner.stop()
	})
	f.actor.start()
	await waitFor(f.actor, (s) => !!s.context.library, { timeout: 1000 })
	const original = f.actor.getSnapshot().context
	f.actor.send({
		type: 'LIBRARY',
		scope: original.scope,
		requestId: crypto.randomUUID(),
		event: { type: 'ADD', url: 'https://example.com/' }
	})
	await vi.waitFor(() => expect(issued).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	clock.increment(5)
	expect(f.actor.getSnapshot().context.closeIssue).toEqual({
		stage: 'application',
		reason: 'overdue'
	})
	expect(f.close).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	pending.resolve({ kind: 'unknown', operationId: id })
	await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
	expect(issued).toHaveBeenCalledOnce()
	expect(f.close).toHaveBeenCalledOnce()
})
