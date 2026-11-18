import { afterEach, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { isTid } from '@atcute/lexicons/syntax'
import * as tid from '@atcute/tid'
import { allocatePublicationAddress } from './address.js'
import { publicationSchema } from '../../annotations/publication.js'
import { toFirstPublicationWrite } from './first-write.js'

const did = 'did:web:owner.example'
vi.mock('@atcute/tid', { spy: true })
afterEach(() => {
	vi.mocked(tid.now).mockReset()
	vi.restoreAllMocks()
	vi.useRealTimers()
})

async function allocate(input = did) {
	const actor = createActor(allocatePublicationAddress, { input })
	try {
		const result = toPromise(actor)
		actor.start()
		return await result
	} finally {
		actor.stop()
	}
}

it('allocates an address accepted by the existing issued and first-write contracts', async () => {
	const uri = await allocate()
	const issued = publicationSchema.parse({
		libraryId: crypto.randomUUID(),
		source: { noteId: crypto.randomUUID() },
		publishingDid: did,
		state: 'issued',
		uri,
		record: {
			$type: 'at.margin.note',
			createdAt: '2026-11-17T12:00:00Z',
			motivation: 'commenting',
			target: { source: 'https://example.org/article' },
			body: { value: 'Frozen', format: 'text/plain' }
		}
	})
	const write = toFirstPublicationWrite(issued)
	expect(isTid(write.rkey)).toBe(true)
	expect(uri).toBe(`at://${did}/at.margin.note/${write.rkey}`)
	expect(write.swapRecord).toBeNull()
})

it('refuses malformed publishers before calling the generator', async () => {
	const generate = vi.mocked(tid.now)
	for (const invalid of [
		'owner.example',
		'did:web:',
		'did:web:owner.example\n',
		'did:WEB:owner.example'
	])
		await expect(allocate(invalid)).rejects.toThrow('Publication address cannot be allocated')
	expect(generate).not.toHaveBeenCalled()
})

it('refuses invalid library output instead of repairing or substituting an identity', async () => {
	vi.mocked(tid.now).mockReturnValueOnce('invalid')
	await expect(allocate()).rejects.toThrow('Publication address cannot be allocated')
})

it('uses the clock library fallback safely during a burst without creating an app counter', async () => {
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
	const first = await allocate()
	expect(tid.parse(first.slice(first.lastIndexOf('/') + 1)).timestamp).toBe(
		new Date('2026-11-17T12:00:00Z').getTime() * 1_000
	)
	const addresses = new Set([first])
	for (let index = 1; index < 1_500; index++) addresses.add(await allocate())
	vi.setSystemTime(new Date('2026-11-17T12:00:00.001Z'))
	for (let index = 0; index < 1_000; index++) addresses.add(await allocate())
	expect(addresses.size).toBe(2_500)
	expect([...addresses].every((uri) => isTid(uri.slice(uri.lastIndexOf('/') + 1)))).toBe(true)
})
