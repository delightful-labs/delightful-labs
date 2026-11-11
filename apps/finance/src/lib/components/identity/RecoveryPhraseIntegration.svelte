<script lang="ts">
	import { getJazzSession } from 'jazz-tools/svelte'
	import RecoveryPhrase from 'delightful-local-first/recovery/svelte'
	import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
	import { createRecoveryMessages } from 'delightful-local-first/recovery/messages'
	import type { RecoveryScopeSource } from 'delightful-local-first/recovery/contracts'
	import { getLocale } from '#lib/paraglide/runtime.js'

	const session = getJazzSession()
	const adapter = createJazzRecoveryAdapter(() => {
		const snapshot = session.getSnapshot()
		return snapshot.status === 'ready' ? snapshot.account : undefined
	})
	const source: RecoveryScopeSource = {
		subscribe(publish) {
			const unsubscribe = session.subscribe((snapshot) => {
				publish(adapter.observeAccount(snapshot.status === 'ready' ? snapshot.account : undefined))
			})
			return () => {
				try {
					unsubscribe()
				} finally {
					adapter.invalidate()
				}
			}
		}
	}
	const messages = $derived(createRecoveryMessages(getLocale()))
</script>

<RecoveryPhrase {source} capability={adapter.capability} {messages} />
