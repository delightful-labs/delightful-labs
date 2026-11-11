import { afterEach, expect, it, vi } from 'vitest'
import { createWorkerHostClient } from './host-client.js'
import { serveWindowHost } from './window-host.js'
import { accountStorageBinding } from './account-selection.js'
import {
	HOST_PROTOCOL_VERSION,
	MAX_ACCOUNT_STORE_LENGTH,
	MAX_EARLIER_STORES,
	MAX_STORAGE_SLOTS
} from './host-protocol.js'

const scope = '11111111-1111-4111-8111-111111111111'
const binding = accountStorageBinding(
	'https://finance.example/jazz/apps/current/accounts',
	'dev',
	scope
)
const legacyKey = (origin: string, environment = 'dev', path = `/apps/${scope}/accounts`) =>
	`jazz-account-selection-v1:${encodeURIComponent(origin + path)}:${encodeURIComponent(environment)}`
const cleanup = new Set<() => void>()
afterEach(() => {
	for (const close of cleanup) close()
	cleanup.clear()
})
function fixture(entries: [string, string][] = []) {
	const values = new Map(entries),
		ports = new MessageChannel()
	const storage = {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value)
		})
	}
	const inventory = {
		get length() {
			return values.size
		},
		key: (index: number) => [...values.keys()][index] ?? null
	}
	const native = {
		origin: 'https://finance.example',
		storage,
		inventory,
		openBroker: () => {
			throw new Error('unused')
		}
	}
	const hostBinding = {
		scope,
		accountStorageKey: binding.key,
		accountSelection: binding,
		broker: { url: 'https://finance.example/broker.js', baseName: 'jazz-runtime:test' }
	}
	const stop = serveWindowHost(ports.port2, hostBinding, native)
	const client = createWorkerHostClient(ports.port1, scope, () => {})
	cleanup.add(stop)
	cleanup.add(client.close)
	cleanup.add(() => ports.port2.close())
	return { values, storage, client, ports, native, hostBinding }
}
it('returns raw ambiguous and invalid earlier values without selecting or rewriting identity', async () => {
	const first = legacyKey('https://old.example'),
		second = legacyKey('https://older.example')
	const f = fixture([
		[binding.key, 'primary'],
		[first, 'invalid-json'],
		[second, 'opaque-identity']
	])
	expect(await f.client.accountStorage.readSnapshot()).toEqual({
		current: 'primary',
		earlier: [
			{ key: first, value: 'invalid-json' },
			{ key: second, value: 'opaque-identity' }
		]
	})
	expect(f.storage.setItem).not.toHaveBeenCalled()
})
it.each([
	legacyKey('https://old.example', 'other'),
	legacyKey('https://old.example', 'dev', '/apps/foreign/accounts'),
	'other-storage-key',
	'jazz-account-selection-v1:%bad:dev'
])('rejects an unadmitted legacy key before native read/write: %s', async (key) => {
	const f = fixture([[key, 'private']])
	expect(await f.client.accountStorage.readSnapshot()).toEqual({ current: null, earlier: [] })
	f.storage.getItem.mockClear()
	await expect(f.client.accountStorage.readEarlier(key)).rejects.toMatchObject({
		reason: 'rejected',
		writeOutcome: 'not-issued'
	})
	await expect(f.client.accountStorage.writeEarlier(key, 'replacement')).rejects.toMatchObject({
		reason: 'rejected',
		writeOutcome: 'not-issued'
	})
	expect(f.storage.getItem).not.toHaveBeenCalled()
	expect(f.storage.setItem).not.toHaveBeenCalled()
})
it('reads and acknowledges only the admitted earlier-key replacement', async () => {
	const key = legacyKey('https://old.example'),
		f = fixture([[key, 'old']])
	expect(await f.client.accountStorage.readEarlier(key)).toBe('old')
	await f.client.accountStorage.writeEarlier(key, 'new')
	expect(f.values.get(key)).toBe('new')
	expect(f.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, 'new')
})
it('rejects a mismatched primary binding before installing the host', () => {
	const f = fixture(),
		ports = new MessageChannel()
	cleanup.add(() => {
		ports.port1.close()
		ports.port2.close()
	})
	expect(() =>
		serveWindowHost(ports.port2, { ...f.hostBinding, accountStorageKey: 'foreign' }, f.native)
	).toThrow('Mismatched account storage binding')
})
it('fails oversized origin inventory without claiming no earlier selection exists', async () => {
	const f = fixture(
		Array.from({ length: MAX_STORAGE_SLOTS + 1 }, (_, index) => [`other-${index}`, 'value'])
	)
	await expect(f.client.accountStorage.readSnapshot()).rejects.toMatchObject({
		reason: 'unavailable'
	})
	expect(f.storage.setItem).not.toHaveBeenCalled()
})
it('fails excess admitted entries instead of silently truncating ambiguity', async () => {
	const f = fixture(
		Array.from({ length: MAX_EARLIER_STORES + 1 }, (_, index) => [
			legacyKey(`https://old-${index}.example`),
			'raw'
		])
	)
	await expect(f.client.accountStorage.readSnapshot()).rejects.toMatchObject({
		reason: 'unavailable'
	})
	expect(f.storage.setItem).not.toHaveBeenCalled()
})
it('enforces individual and aggregate account-value bounds', async () => {
	const first = legacyKey('https://old.example'),
		second = legacyKey('https://older.example')
	const f = fixture([[first, 'x'.repeat(MAX_ACCOUNT_STORE_LENGTH + 1)]])
	await expect(f.client.accountStorage.readSnapshot()).rejects.toMatchObject({
		reason: 'unavailable'
	})
	await expect(f.client.accountStorage.readEarlier(first)).rejects.toMatchObject({
		reason: 'unavailable'
	})
	f.values.set(first, 'x'.repeat(MAX_ACCOUNT_STORE_LENGTH))
	f.values.set(second, 'x'.repeat(MAX_ACCOUNT_STORE_LENGTH))
	await expect(f.client.accountStorage.readSnapshot()).rejects.toMatchObject({
		reason: 'unavailable'
	})
	expect(f.storage.setItem).not.toHaveBeenCalled()
})
it('does not replay an admitted earlier-key write with the same sequence', async () => {
	const key = legacyKey('https://old.example'),
		f = fixture()
	const send = (value: string) =>
		new Promise<unknown>((resolve) => {
			f.ports.port1.addEventListener('message', (event) => resolve(event.data), { once: true })
			f.ports.port1.postMessage({
				version: HOST_PROTOCOL_VERSION,
				scope,
				requestId: crypto.randomUUID(),
				sequence: 1,
				type: 'WRITE_EARLIER',
				key,
				value
			})
		})
	expect(await send('first')).toMatchObject({ type: 'WRITTEN' })
	expect(await send('replayed')).toMatchObject({ type: 'FAILED', reason: 'rejected' })
	expect(f.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, 'first')
})
it('retains unknown-write classification for a fallible earlier-key write', async () => {
	const f = fixture()
	f.storage.setItem.mockImplementation(() => {
		throw new Error('private account material')
	})
	await expect(
		f.client.accountStorage.writeEarlier(legacyKey('https://old.example'), 'selection')
	).rejects.toMatchObject({
		reason: 'unavailable',
		writeOutcome: 'unknown',
		message: 'Finance worker host unavailable'
	})
})
