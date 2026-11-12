import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import type { LinkStatus } from 'jazz-tools'
import { readRecordMachine } from './read.js'
import { fixtureReaderDocument, fixtureAttachment } from '../../capture/fixtures.test-support.js'
import type { ReadCapabilities, ReadResult } from '../../contracts/storage.js'
const document = fixtureReaderDocument({ attachment: fixtureAttachment() })
function connection(initial: LinkStatus['state'] = 'connecting') {
	let state = initial
	const observed = Promise.withResolvers<void>(),
		listeners = new Set<(state: LinkStatus['state']) => void>()
	return {
		observed: observed.promise,
		listeners,
		observeConnection: vi.fn((next: (state: LinkStatus['state']) => void) => {
			listeners.add(next)
			observed.resolve()
			next(state)
			return () => {
				listeners.delete(next)
			}
		}),
		emit(next: LinkStatus['state']) {
			state = next
			for (const listener of listeners) listener(state)
		}
	}
}
function fixture() {
	const link = connection()
	let present = false,
		current = true
	const capability = {
		isCurrent: () => current,
		observeConnection: link.observeConnection,
		document: vi.fn(async () => (present ? document : null))
	} satisfies ReadCapabilities
	const results: ReadResult[] = [],
		actor = createActor(readRecordMachine, { input: { id: document.id, capability } })
	actor.on('record', (event) => results.push(event.result))
	actor.start()
	return {
		actor,
		results,
		capability,
		link,
		store: () => {
			present = true
		},
		loseScope: () => {
			current = false
		}
	}
}
it('waits for connection startup to retry an incomplete joined record', async () => {
	const f = fixture()
	await f.link.observed
	expect(f.results).toEqual([])
	f.link.emit('connecting')
	expect(f.capability.document).toHaveBeenCalledOnce()
	f.store()
	f.link.emit('connected')
	expect(await toPromise(f.actor)).toEqual({ kind: 'available' })
	expect(f.results[0]).toMatchObject({ kind: 'available', text: 'Saved text' })
	expect(f.capability.document).toHaveBeenCalledTimes(2)
	expect(f.link.listeners.size).toBe(0)
})
it.each(['offline', 'local-only', 'connecting'])(
	'opens a cached joined Document while %s',
	async (initial) => {
		const link = connection(
			initial === 'offline' ? 'offline' : initial === 'local-only' ? 'local-only' : 'connecting'
		)
		const actor = createActor(readRecordMachine, {
			input: {
				id: document.id,
				capability: {
					isCurrent: () => true,
					observeConnection: link.observeConnection,
					document: async () => document
				}
			}
		}).start()
		expect(await toPromise(actor)).toEqual({ kind: 'available' })
		expect(link.observeConnection).not.toHaveBeenCalled()
	}
)
it.each(['offline', 'local-only', 'connected'])(
	'settles a missing Document after connection resolves to %s',
	async (state) => {
		const f = fixture()
		await f.link.observed
		f.link.emit(
			state === 'offline' ? 'offline' : state === 'local-only' ? 'local-only' : 'connected'
		)
		expect(await toPromise(f.actor)).toEqual({ kind: 'missing' })
		expect(f.link.listeners.size).toBe(0)
	}
)
it('releases startup observation when canceled and rejects late scope results', async () => {
	const f = fixture()
	await f.link.observed
	f.actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(f.actor)).toEqual({ kind: 'unavailable' })
	expect(f.link.listeners.size).toBe(0)
	f.store()
	f.link.emit('connected')
	expect(f.results).toEqual([{ kind: 'unavailable' }])
	const g = fixture()
	await g.link.observed
	g.loseScope()
	g.store()
	g.link.emit('connected')
	expect(await toPromise(g.actor)).toEqual({ kind: 'unavailable' })
})
