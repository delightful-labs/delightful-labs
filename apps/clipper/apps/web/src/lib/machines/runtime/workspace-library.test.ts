import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { readyAccount } from './session.test-support.js'
import {
	workspaceLibraryMachine,
	selectWorkspaceLibrary,
	workspaceLibraryCommands
} from './workspace-library.js'
import type { WorkspaceAccess, AccountCapabilities } from '../../contracts/account.js'
import { controlledSave, testLibraryCapability } from '../capture/library.test-support.js'
import type { SaveResult } from '../../contracts/storage.js'

const cleanups = new Set<() => void>()
afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups.clear()
})
function accessFixture() {
	let publish: Parameters<WorkspaceAccess['subscribe']>[0] | undefined
	let fail: (() => void) | undefined
	const dispose = vi.fn()
	const access: WorkspaceAccess = {
		workspaceId: 'A',
		subscribe: (next, error) => {
			publish = next
			fail = error
			next('unknown')
			return dispose
		}
	}
	return {
		access,
		dispose,
		emit: (value: 'allowed' | 'unknown' | 'denied') => publish?.(value),
		fail: () => fail?.()
	}
}
function fixture(createLibrary?: AccountCapabilities['createLibrary']) {
	const source = accessFixture()
	const original = readyAccount()
	const account = {
		...original,
		capabilities: {
			...original.capabilities,
			access: source.access,
			createLibrary: createLibrary ?? original.capabilities.createLibrary
		}
	}
	const scope = { binding: account.binding, attachment: {} }
	const report = vi.fn()
	const actor = createActor(workspaceLibraryMachine, {
		input: { scope, account, reportDisposalFailure: report }
	})
	cleanups.add(() => actor.stop())
	return { source, account, scope, report, actor }
}
function selected(f: ReturnType<typeof fixture>) {
	return waitFor(f.actor, (snapshot) => !!selectWorkspaceLibrary(snapshot).library, {
		timeout: 1000
	})
}
function binding(f: ReturnType<typeof fixture>) {
	const view = selectWorkspaceLibrary(f.actor.getSnapshot())
	if (!view.lease || !view.library) throw new Error('Missing admitted library')
	return { owner: f.actor, lease: view.lease, library: view.library }
}
it('allocates only on ongoing allowed access, retains duplicate leases and joins access release on close', async () => {
	const f = fixture()
	f.actor.start()
	expect(f.account.capabilities.createLibrary).not.toHaveBeenCalled()
	expect(selectWorkspaceLibrary(f.actor.getSnapshot()).library).toBeUndefined()
	f.source.emit('allowed')
	await selected(f)
	const first = binding(f)
	expect(first.lease.scope).toEqual(f.scope)
	for (let count = 0; count < 4; count++) f.source.emit('allowed')
	expect(binding(f).lease).toBe(first.lease)
	expect(binding(f).library).toBe(first.library)
	expect(f.account.capabilities.createLibrary).toHaveBeenCalledOnce()
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.actor)).toEqual({ outcome: 'released' })
	expect(f.source.dispose).toHaveBeenCalledOnce()
	expect(f.report).not.toHaveBeenCalled()
})

it('withdraws admission before draining and rejects retired commands after same-workspace regrant', async () => {
	const pending = Promise.withResolvers<SaveResult>()
	const issued = vi.fn(() => pending.promise)
	const save = controlledSave(issued)
	const create = vi.fn((live: () => boolean) =>
		testLibraryCapability(
			{
				id: crypto.randomUUID(),
				title: 'Local',
				text: 'Local',
				html: '<p>Local</p>',
				submittedUrl: 'https://example.com/',
				finalUrl: 'https://example.com/',
				provenance: '{}',
				imagesMissing: false
			},
			{ isCurrent: live, spawnSave: (spawn, input) => spawn(save, { input }) }
		)
	)
	const f = fixture(create)
	f.actor.start()
	f.source.emit('allowed')
	await selected(f)
	const first = binding(f)
	const old = workspaceLibraryCommands(first)
	old.send({ type: 'ADD', url: 'https://example.com/first' })
	await vi.waitFor(() => expect(issued).toHaveBeenCalledOnce())
	f.source.emit('denied')
	expect(selectWorkspaceLibrary(f.actor.getSnapshot()).lease).toBeUndefined()
	expect(selectWorkspaceLibrary(f.actor.getSnapshot()).library).toBeUndefined()
	f.source.emit('allowed')
	old.send({ type: 'ADD', url: 'https://example.com/retired' })
	expect(create).toHaveBeenCalledOnce()
	expect(issued).toHaveBeenCalledOnce()
	pending.resolve({ kind: 'unknown', operationId: crypto.randomUUID() })
	await selected(f)
	const next = binding(f)
	expect(next.lease.epoch).toBeGreaterThan(first.lease.epoch)
	expect(next.library).not.toBe(first.library)
	expect(create).toHaveBeenCalledTimes(2)
	old.send({ type: 'ADD', url: 'https://example.com/still-retired' })
	expect(issued).toHaveBeenCalledOnce()
	workspaceLibraryCommands(next).send({ type: 'ADD', url: 'https://example.com/current' })
	await vi.waitFor(() => expect(issued).toHaveBeenCalledTimes(2))
	f.actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.actor)).toEqual({ outcome: 'released' })
})

it('retains unresolved access disposal and never replaces it with a clean terminal result', async () => {
	const f = fixture()
	f.source.dispose.mockImplementation(() => {
		throw new Error('Access disposal failed')
	})
	f.actor.start()
	f.source.emit('allowed')
	await selected(f)
	f.actor.send({ type: 'SHUTDOWN' })
	await waitFor(f.actor, (snapshot) => selectWorkspaceLibrary(snapshot).failed, { timeout: 1000 })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.actor.send({ type: 'SHUTDOWN' })
	f.source.emit('allowed')
	expect(selectWorkspaceLibrary(f.actor.getSnapshot()).library).toBeUndefined()
	expect(f.account.capabilities.createLibrary).toHaveBeenCalledOnce()
	expect(f.source.dispose).toHaveBeenCalledOnce()
	expect(f.report).toHaveBeenCalledOnce()
})

it('withdraws a live library on a native access error without closing the identity-owned client', async () => {
	const f = fixture()
	f.actor.start()
	f.source.emit('allowed')
	await selected(f)
	f.source.fail()
	expect(selectWorkspaceLibrary(f.actor.getSnapshot()).library).toBeUndefined()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.actor)).toEqual({ outcome: 'released' })
	expect(f.source.dispose).toHaveBeenCalledOnce()
})

it('releases a refused reader surface through the original lease envelope', async () => {
	const f = fixture()
	f.actor.start()
	f.source.emit('allowed')
	await selected(f)
	const old = workspaceLibraryCommands(binding(f))
	f.source.emit('denied')
	const channel = new MessageChannel()
	const released = vi.fn()
	try {
		const command = {
			type: 'READER_EVENT',
			event: {
				type: 'ATTACH_SURFACE',
				documentId: 'retired-document',
				sources: [],
				surface: {
					viewport: { port: channel.port1 },
					fullscreen: {
						supported: () => false,
						active: () => false,
						enter: async () => {},
						exit: async () => {},
						observe: () => () => {}
					},
					lifecycle: { accepted: vi.fn(), released }
				}
			}
		} satisfies Parameters<typeof old.send>[0]
		old.send(command)
		expect(released).toHaveBeenCalledOnce()
		f.actor.send({ type: 'SHUTDOWN' })
		expect(await toPromise(f.actor)).toEqual({ outcome: 'released' })
		const lateReleased = vi.fn()
		old.send({
			...command,
			event: {
				...command.event,
				surface: {
					...command.event.surface,
					lifecycle: { accepted: vi.fn(), released: lateReleased }
				}
			}
		})
		expect(lateReleased).toHaveBeenCalledOnce()
		expect(released).toHaveBeenCalledOnce()
	} finally {
		channel.port1.close()
		channel.port2.close()
	}
})
