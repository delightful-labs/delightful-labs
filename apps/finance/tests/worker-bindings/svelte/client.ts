import 'delightful-ui/theme.css'
import { mount, unmount, tick } from 'svelte'
import {
	createJazzClient,
	type JazzSession,
	type JazzClient,
	type AccountStore
} from 'jazz-tools/client'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { createRecoveryMessages } from 'delightful-local-first/recovery/messages'
import { createFinanceAccountStore } from '../../../src/lib/runtime/worker/account-store.js'
import wasmUrl from '#jazz-wasm-binary?url'
import Fixture from './Fixture.svelte'

// Test controls retain the actual SDK session and native Svelte disposer. Keys
// and phrases never leave this browser module; assertions receive booleans.
let session: JazzSession<JazzClient> | undefined
let store: ReturnType<typeof createFinanceAccountStore> | undefined
let dispose: (() => Promise<void>) | undefined
let held: ReturnType<typeof Promise.withResolvers<void>> | undefined
let operation: Promise<void> | undefined
let reads = 0
function current() {
	if (!session) throw new Error('Native session not open')
	return session
}
const fixture = {
	async open(scope: string, brokerUrl: string) {
		if (session) throw new Error('Native session already open')
		const serverUrl = location.origin + '/jazz'
		const selected = createFinanceAccountStore({ serverUrl, scope, environment: 'svelte-proof' })
		const accountStore: AccountStore = {
			read: () => {
				reads++
				return selected.read()
			},
			update: async (transform) => {
				await held?.promise
				await selected.update(transform)
			}
		}
		try {
			session = await createJazzClient({
				serverUrl,
				scope,
				env: 'svelte-proof',
				store: accountStore,
				initial: 'device',
				localFirst: 'now',
				client: () => import('jazz-tools/local-first'),
				runtimeSources: { wasmUrl, brokerWorkerUrl: brokerUrl, wasmVersion: 'finance-sdk-proof-1' }
			})
			store = selected
		} catch (error) {
			await selected.close()
			throw error
		}
	},
	async show() {
		if (dispose) throw new Error('Provider already mounted')
		const target = document.getElementById('fixture')
		if (!target) throw new Error('Missing fixture target')
		const component = mount(Fixture, { target, props: { session: current() } })
		dispose = () => unmount(component)
		await tick()
	},
	async hide() {
		await dispose?.()
		dispose = undefined
		await tick()
	},
	state() {
		const snapshot = current().getSnapshot()
		return { status: snapshot.status, accountId: snapshot.user?.accountId, reads }
	},
	labels: () => createRecoveryMessages('en'),
	phraseMatchesNative() {
		const field = document.getElementsByTagName('textarea').item(0)
		return field !== null && field.value === RecoveryPhrase.fromSecret(current().exportDeviceKey())
	},
	beginSameAccountRestore() {
		if (operation || held) throw new Error('Native operation already pending')
		held = Promise.withResolvers<void>()
		operation = current().restoreDeviceAccount(current().exportDeviceKey())
		void operation.catch(() => {})
	},
	async finishRestore() {
		held?.resolve()
		held = undefined
		await operation
		operation = undefined
	},
	signOut: () => current().signOut(),
	reopen: () => current().reopenDeviceAccount(),
	closeSession: () => current().close(),
	async dispose() {
		await fixture.hide()
		await current().close()
		await store?.close()
		session = undefined
		store = undefined
	}
}
declare global {
	interface Window {
		financeSvelteFixture: typeof fixture
	}
}
window.financeSvelteFixture = fixture
