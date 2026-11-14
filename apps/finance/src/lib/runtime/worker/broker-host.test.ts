import { afterEach, expect, it, vi } from 'vitest'
import { brokerHostClient } from 'delightful-local-first/backend/jazz/worker-broker'
import {
	serveFinanceBrokerGrant,
	serveFinanceGenerationGrant,
	type FinanceBrokerGrant,
	type FinanceGenerationGrant
} from './broker-host.js'

const origin = 'https://finance.example'
const url = `${origin}/assets/broker.js`
const baseName = 'jazz-runtime:finance-selected-physical-root'
const name = `${baseName}:generation-2`
const key = `jazz:shared-worker-generation:${baseName}`
const releases = new Set<() => void>()
afterEach(() => {
	for (const release of releases) release()
	releases.clear()
	vi.restoreAllMocks()
})
function pair() {
	const channel = new MessageChannel()
	releases.add(() => {
		channel.port1.close()
		channel.port2.close()
	})
	return channel
}
function nativeFixture() {
	const peer = pair()
	const native = {
		origin,
		storage: { getItem: vi.fn((): string | null => 'raw SDK value'), setItem: vi.fn() },
		openBroker: vi.fn((_url: string, _name: string) =>
			Object.assign(new EventTarget(), { port: peer.port1 })
		)
	}
	return { peer, native }
}
function connect(scope: string, serve: (data: MessagePort, control: MessagePort) => () => void) {
	const data = pair(),
		control = pair()
	const release = serve(data.port1, control.port1)
	const client = brokerHostClient(data.port2, control.port2, scope, {
		onOverdue: vi.fn(),
		onBlocked: vi.fn()
	})
	releases.add(() => {
		client.dispose()
		release()
	})
	return { data, control, client }
}
function generationFixture(grant: FinanceGenerationGrant = { scope: crypto.randomUUID(), key }) {
	const f = nativeFixture()
	return {
		...f,
		grant,
		...connect(grant.scope, (data, control) =>
			serveFinanceGenerationGrant(data, control, grant, f.native)
		)
	}
}
function brokerFixture(grant: FinanceBrokerGrant = { scope: crypto.randomUUID(), url, name }) {
	const f = nativeFixture()
	return {
		...f,
		grant,
		...connect(grant.scope, (data, control) =>
			serveFinanceBrokerGrant(data, control, grant, f.native)
		)
	}
}

it('reads raw generation values and absence and writes only the admitted key on its native receiver', async () => {
	const f = generationFixture()
	expect(await f.client.readGeneration(key)).toBe('raw SDK value')
	f.native.storage.getItem.mockReturnValueOnce(null)
	expect(await f.client.readGeneration(key)).toBeNull()
	await f.client.writeGeneration(key, '3')
	expect(f.native.storage.getItem.mock.calls).toEqual([[key], [key]])
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '3')
	expect(f.native.storage.getItem.mock.instances).toEqual([f.native.storage, f.native.storage])
	expect(f.native.storage.setItem.mock.instances[0]).toBe(f.native.storage)
	expect(f.native.openBroker).not.toHaveBeenCalled()
	expect(await f.client.close()).toEqual(f.client.host.identity)
})

it.each(['read', 'write'])(
	'rejects another generation key on %s before native storage',
	async (kind) => {
		const f = generationFixture()
		await expect(
			kind === 'read'
				? f.client.readGeneration(key + ':foreign')
				: f.client.writeGeneration(key + ':foreign', '2')
		).rejects.toMatchObject({ workerEffectOutcome: 'not-issued' })
		expect(f.native.storage.getItem).not.toHaveBeenCalled()
		expect(f.native.storage.setItem).not.toHaveBeenCalled()
		expect(await f.client.readGeneration(key)).toBe('raw SDK value')
		await f.client.close()
	}
)

it('cannot use a generation grant to construct even the otherwise valid broker', async () => {
	const f = generationFixture()
	await expect(f.client.open(url, name)).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	expect(f.native.openBroker).not.toHaveBeenCalled()
	expect(f.native.storage.getItem).not.toHaveBeenCalled()
	expect(f.native.storage.setItem).not.toHaveBeenCalled()
	expect(await f.client.readGeneration(key)).toBe('raw SDK value')
	await f.client.close()
})

it('opens the exact canonical script/name and preserves the accepted SDK port after host closure', async () => {
	const f = brokerFixture()
	const opened = await f.client.open('https://FINANCE.EXAMPLE:443/assets/./broker.js', name)
	releases.add(() => opened.port.close())
	expect(f.native.openBroker).toHaveBeenCalledExactlyOnceWith(url, name)
	expect(f.native.openBroker.mock.instances[0]).toBe(f.native)
	expect(await f.client.close()).toEqual(f.client.host.identity)
	let resolve!: (value: unknown) => void
	const received = new Promise<unknown>((accept) => {
		resolve = accept
	})
	f.peer.port2.onmessage = ({ data }) => resolve(data)
	opened.port.postMessage('SDK still owns the accepted port')
	expect(await received).toBe('SDK still owns the accepted port')
	expect(f.native.storage.getItem).not.toHaveBeenCalled()
	expect(f.native.storage.setItem).not.toHaveBeenCalled()
})

it.each([
	['https://other.example/assets/broker.js', name],
	[`${origin}/assets/other.js`, name],
	[`${url}?foreign=1`, name],
	['https://private-secret@finance.example/assets/broker.js', name],
	[url, baseName],
	[url, `${baseName}-foreign:generation-2`],
	[url, `${baseName}:generation-0`],
	[url, `${baseName}:generation--1`],
	[url, `${baseName}:generation-1.5`],
	[url, `${baseName}:generation-9007199254740992`],
	[url, name + ':foreign']
])(
	'refuses an unbound script or full worker name before construction %#',
	async (candidate, workerName) => {
		const f = brokerFixture()
		await expect(f.client.open(candidate, workerName)).rejects.toMatchObject({
			workerEffectOutcome: 'not-issued'
		})
		expect(f.native.openBroker).not.toHaveBeenCalled()
		expect(f.native.storage.getItem).not.toHaveBeenCalled()
		expect(f.native.storage.setItem).not.toHaveBeenCalled()
		await f.client.close()
	}
)

it.each(['read', 'write'])('cannot use a broker grant for generation %s', async (kind) => {
	const f = brokerFixture()
	await expect(
		kind === 'read' ? f.client.readGeneration(key) : f.client.writeGeneration(key, '2')
	).rejects.toMatchObject({ workerEffectOutcome: 'not-issued' })
	expect(f.native.storage.getItem).not.toHaveBeenCalled()
	expect(f.native.storage.setItem).not.toHaveBeenCalled()
	const opened = await f.client.open(url, name)
	releases.add(() => opened.port.close())
	expect(f.native.openBroker).toHaveBeenCalledExactlyOnceWith(url, name)
	await f.client.close()
})

it('captures the generation key and scope before caller configuration changes', async () => {
	const f = generationFixture()
	f.grant.key = key + ':replacement'
	f.grant.scope = crypto.randomUUID()
	expect(await f.client.readGeneration(key)).toBe('raw SDK value')
	await f.client.writeGeneration(key, '4')
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '4')
	await expect(f.client.readGeneration(f.grant.key)).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	await f.client.close()
})

it('captures the canonical URL, full name and scope before caller configuration changes', async () => {
	const f = brokerFixture({
		scope: crypto.randomUUID(),
		url: 'https://FINANCE.EXAMPLE:443/assets/./broker.js',
		name
	})
	f.grant.url = `${origin}/different.js`
	f.grant.name = `${baseName}:generation-3`
	f.grant.scope = crypto.randomUUID()
	const opened = await f.client.open(url, name)
	releases.add(() => opened.port.close())
	expect(f.native.openBroker).toHaveBeenCalledExactlyOnceWith(url, name)
	await expect(f.client.open(f.grant.url, f.grant.name)).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	await f.client.close()
})

it.each([
	{ kind: 'generation', fixture: generationFixture },
	{ kind: 'broker', fixture: brokerFixture }
])(
	'retains independent $kind host closure after data failure and refuses late calls',
	async ({ fixture }) => {
		const f = fixture()
		f.data.port1.dispatchEvent(new MessageEvent('messageerror'))
		expect(await f.client.host.closed).toEqual(f.client.host.identity)
		await expect(f.client.readGeneration(key)).rejects.toMatchObject({
			workerEffectOutcome: 'not-issued'
		})
		await expect(f.client.open(url, name)).rejects.toMatchObject({
			workerEffectOutcome: 'not-issued'
		})
		expect(f.native.storage.getItem).not.toHaveBeenCalled()
		expect(f.native.openBroker).not.toHaveBeenCalled()
	}
)

it('closing one grant does not close the other grant', async () => {
	const generation = generationFixture(),
		broker = brokerFixture()
	expect(generation.client.host.identity.scope).not.toBe(broker.client.host.identity.scope)
	await generation.client.close()
	await expect(generation.client.readGeneration(key)).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	const opened = await broker.client.open(url, name)
	releases.add(() => opened.port.close())
	expect(broker.native.openBroker).toHaveBeenCalledExactlyOnceWith(url, name)
	expect(await broker.client.close()).toEqual(broker.client.host.identity)
})

it('does not replay a generation write after the native effect throws', async () => {
	const f = generationFixture()
	f.native.storage.setItem.mockImplementationOnce(() => {
		throw new Error('private native failure')
	})
	await expect(f.client.writeGeneration(key, '4')).rejects.toMatchObject({
		workerEffectOutcome: 'unknown'
	})
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '4')
	expect(await f.client.close()).toEqual(f.client.host.identity)
})

it.each([
	{ scope: 'invalid', key },
	{ scope: crypto.randomUUID(), key: 'foreign-prefix' },
	{ scope: crypto.randomUUID(), key: key + 'x'.repeat(65536) },
	{ scope: crypto.randomUUID(), key, extra: 'not accepted' }
])('refuses invalid generation configuration before listeners %#', (grant) => {
	const data = pair(),
		control = pair(),
		f = nativeFixture()
	const observe = vi.spyOn(data.port1, 'addEventListener')
	expect(() => serveFinanceGenerationGrant(data.port1, control.port1, grant, f.native)).toThrow(
		new Error('Invalid Finance generation grant')
	)
	expect(observe).not.toHaveBeenCalled()
	expect(f.native.storage.getItem).not.toHaveBeenCalled()
	expect(f.native.storage.setItem).not.toHaveBeenCalled()
})

it.each([
	{ scope: 'invalid', url, name },
	{ scope: crypto.randomUUID(), url: 'https://foreign.example/broker.js', name },
	{ scope: crypto.randomUUID(), url: 'https://secret@finance.example/broker.js', name },
	{ scope: crypto.randomUUID(), url: 'file:///private/broker.js', name },
	{ scope: crypto.randomUUID(), url, name: 'foreign-prefix:generation-0' },
	{ scope: crypto.randomUUID(), url, name: baseName },
	{ scope: crypto.randomUUID(), url, name: `${baseName}:generation--1` },
	{ scope: crypto.randomUUID(), url, name: `${baseName}:generation-1.5` },
	{ scope: crypto.randomUUID(), url, name: `${baseName}:generation-9007199254740992` },
	{ scope: crypto.randomUUID(), url, name: `${baseName}:generation-12345678901234567` },
	{ scope: crypto.randomUUID(), url, name: name + 'x'.repeat(65536) },
	{ scope: crypto.randomUUID(), url: url + 'x'.repeat(8192), name },
	{ scope: crypto.randomUUID(), url, name, extra: 'not accepted' }
])('refuses invalid broker configuration before listeners %#', (grant) => {
	const data = pair(),
		control = pair(),
		f = nativeFixture()
	const observe = vi.spyOn(data.port1, 'addEventListener')
	expect(() => serveFinanceBrokerGrant(data.port1, control.port1, grant, f.native)).toThrow(
		/Invalid Finance broker/
	)
	expect(observe).not.toHaveBeenCalled()
	expect(f.native.openBroker).not.toHaveBeenCalled()
})
