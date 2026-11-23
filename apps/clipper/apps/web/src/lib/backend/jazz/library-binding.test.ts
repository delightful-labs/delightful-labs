import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { createLibraryBinding, createLibraryCapture } from './library-binding.js'
import { createLibraryCapability } from './library.js'
import permissions from './jazz.permissions.json' with { type: 'json' }
import { app } from './jazz.generated.js'
import { createActor, toPromise } from 'xstate'
import { rootBootstrapMachine } from '../../machines/runtime/root-bootstrap.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => fixture?.shutdown())
afterEach(() => vi.unstubAllGlobals())

it('reuses native root and library builders without exposing their database', async () => {
	const session = {
		user_id: 'library-binding-owner',
		authMode: 'local-first',
		claims: {}
	} satisfies PolicyTestSession
	const db = fixture.as(session),
		identityId = fixture.accountFor(session)
	let current = true
	const binding = createLibraryBinding({
		db,
		identityId,
		isCurrent: () => current,
		libraryFactory: createLibraryCapability,
		cacheNamespace: 'library-binding-test'
	})
	expect(await binding.root.read()).toBe('missing')
	const write = binding.root.ensure()
	await write.local()
	await write.global()
	expect(await binding.root.read()).toBe('compatible')
	const library = binding.createLibrary()
	expect(library.libraryId).toBe(identityId)
	expect(library.isCurrent()).toBe(true)
	current = false
	expect(library.isCurrent()).toBe(false)
	expect(() => binding.root.ensure()).toThrow('Account scope expired')
	await expect(binding.root.read()).rejects.toThrow('Account scope expired')
	expect(() => binding.createLibrary()).toThrow('Account scope expired')
	// Invalidating a capability must not dispose the application's shared Db.
	expect(await db.one(app.libraries.where({ id: identityId }))).toMatchObject({
		ownerId: identityId
	})
})

it('refuses capture before dispatch and retires a response after binding replacement', async () => {
	const db = fixture.as({ user_id: 'capture-binding-owner', authMode: 'local-first', claims: {} })
	let current = false
	const response = new Response('captured body')
	if (!response.body) throw new Error('Missing native response stream')
	const cancel = vi.spyOn(response.body, 'cancel')
	const pending = Promise.withResolvers<Response>()
	const fetcher = vi.fn(() => pending.promise)
	vi.stubGlobal('fetch', fetcher)
	const capture = createLibraryCapture(db, () => current)
	await expect(capture('extract', {})).rejects.toThrow('Account scope expired')
	expect(fetcher).not.toHaveBeenCalled()
	current = true
	const result = capture('extract', {})
	expect(fetcher).toHaveBeenCalledOnce()
	current = false
	pending.resolve(response)
	await expect(result).rejects.toThrow('Account scope expired')
	expect(cancel).toHaveBeenCalledOnce()
})

it('converges concurrent shared initialization on one native canonical root and reopens it without a write', async () => {
	const session = {
		user_id: 'concurrent-canonical-root',
		authMode: 'local-first',
		claims: {}
	} satisfies PolicyTestSession
	const db = fixture.as(session)
	const identityId = fixture.accountFor(session)
	const makeBinding = () =>
		createLibraryBinding({
			db,
			identityId,
			isCurrent: () => true,
			libraryFactory: createLibraryCapability,
			cacheNamespace: 'concurrent-canonical-root'
		})
	const owners = Array.from({ length: 4 }, () =>
		createActor(rootBootstrapMachine, {
			input: { db: makeBinding().root, userId: identityId }
		})
	)
	try {
		const results = await Promise.all(owners.map((owner) => toPromise(owner.start())))
		for (const result of results) {
			expect(result.outcome).toBe('ready')
			if (result.outcome === 'ready') {
				expect(result.workspaceId).toBe(identityId)
				if (result.persistence?.outcome === 'succeeded') await result.persistence.write.global()
			}
		}
		expect(await db.all(app.libraries.where({ ownerId: identityId }))).toHaveLength(1)
		const root = makeBinding().root
		const ensure = vi.fn(() => root.ensure())
		const reopened = createActor(rootBootstrapMachine, {
			input: { db: { read: root.read, ensure }, userId: identityId }
		})
		try {
			expect(await toPromise(reopened.start())).toEqual({
				outcome: 'ready',
				identityId,
				workspaceId: identityId
			})
			expect(ensure).not.toHaveBeenCalled()
		} finally {
			reopened.stop()
		}
	} finally {
		for (const owner of owners) owner.stop()
	}
})
