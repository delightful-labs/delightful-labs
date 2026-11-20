import { accountStorageKey } from '../src/lib/runtime/worker/storage-channel.js'
import { createScopedWorkerAccountStore } from '../src/lib/runtime/worker/scoped-account-store.js'
import {
	createScopedAccountStorage,
	serveScopedAccountStorage
} from '../src/lib/runtime/worker/scoped-storage-channel.js'

/** Test-only Window host using the production scoped storage protocol and owner. */
export function browserAccountStore(serverUrl: string) {
	const key = accountStorageKey(serverUrl),
		scope = crypto.randomUUID()
	const data = new MessageChannel(),
		control = new MessageChannel()
	const stopHost = serveScopedAccountStorage(data.port1, control.port1, scope, localStorage, key)
	const storage = createScopedAccountStorage(data.port2, control.port2, scope, {
		onOverdue: () => console.error('Fixture account storage overdue'),
		onBlocked: () => console.error('Fixture account storage blocked')
	})
	const store = createScopedWorkerAccountStore(key, storage, {
		onOverdue: () => console.error('Fixture account store overdue')
	})
	return {
		store,
		close: async () => {
			await store.close()
			await storage.close()
			stopHost()
		}
	}
}

export function fixtureServerUrl() {
	const configured = import.meta.env.PUBLIC_JAZZ_SERVER_URL
	return new URL(configured === 'same-origin' ? '/jazz' : configured, location.origin).href
}
