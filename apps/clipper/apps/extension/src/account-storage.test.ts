import { locks } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { createJazzClient, type JazzSession, type JazzClient } from 'jazz-tools/client'
import { startTestJazz } from 'jazz-tools/testing'
import { app } from '../../web/src/lib/backend/jazz/jazz.generated.js'
import permissions from '../../web/src/lib/backend/jazz/jazz.permissions.json' with { type: 'json' }
import { extensionAccountStorageKey } from './account-storage.js'
import { createWorkerAccountStore } from '../../web/tests/legacy-account-store.js'

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])(
	'reopens the native SDK selection from the worker without replacing it (trailing slash: %s)',
	async (trailingSlash) => {
		const authority = await startTestJazz({ app, permissions })
		const serverUrl = authority.url.replace(/\/+$/, '') + (trailingSlash ? '/' : '')
		const values = new Map<string, string>()
		vi.stubGlobal('navigator', { locks })
		vi.stubGlobal('localStorage', {
			get length() {
				return values.size
			},
			key: (index: number) => [...values.keys()][index] ?? null,
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value)
		})
		const configuration = {
			serverUrl,
			env: 'clipper',
			initial: 'device',
			client: () => import('jazz-tools/local-first'),
			localFirst: 'now',
			driver: { type: 'memory' }
		} satisfies Parameters<typeof createJazzClient>[0]
		const sessions: JazzSession<JazzClient>[] = []
		try {
			const native = await createJazzClient(configuration)
			sessions.push(native)
			const original = native.getSnapshot().user
			if (!original) throw new Error('Native device account unavailable')
			const key = extensionAccountStorageKey(serverUrl)
			expect([...values.keys()]).toEqual([key])
			const selection = values.get(key)
			const originalKey = native.exportDeviceKey()
			await native.close()
			const store = createWorkerAccountStore(key, {
				read: async () => values.get(key) ?? null,
				write: async (value) => {
					values.set(key, value)
				}
			})
			// The adapter passes native registry bytes through unchanged. Opening a
			// session may refresh Jazz's cached token, while preserving its root.
			expect((await store.read()) === selection).toBe(true)
			const worker = await createJazzClient({ ...configuration, store })
			sessions.push(worker)
			expect(worker.getSnapshot().user?.accountId).toBe(original.accountId)
			// A failed assertion must not print the stored device credential.
			expect(worker.exportDeviceKey() === originalKey).toBe(true)
			await worker.createDeviceAccount()
			const replacement = worker.getSnapshot().user?.accountId
			await worker.close()
			const reopened = await createJazzClient(configuration)
			sessions.push(reopened)
			expect(reopened.getSnapshot().user?.accountId).toBe(replacement)
			expect([...values.keys()]).toEqual([key])
		} finally {
			await Promise.all(sessions.map((session) => session.close()))
			await authority.stop()
		}
	}
)
