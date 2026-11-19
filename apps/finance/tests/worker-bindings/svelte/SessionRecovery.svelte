<script lang="ts">
	import { get } from 'svelte/store'
	import { getJazzSession } from 'jazz-tools/svelte'
	import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
	import type { RecoveryScopeSource } from 'delightful-local-first/recovery/contracts'
	import WorkerRecovery from '../../../src/lib/components/worker/WorkerRecovery.svelte'

	const store = getJazzSession()
	const session = { getSnapshot: () => get(store), exportDeviceKey: store.exportDeviceKey }
	const adapter = createJazzRecoveryAdapter(() => session)
	const source: RecoveryScopeSource = {
		subscribe(publish) {
			const unsubscribe = store.subscribe(() => publish(adapter.observeSession()))
			return () => {
				try {
					unsubscribe()
				} finally {
					adapter.invalidate()
				}
			}
		}
	}
</script>

<WorkerRecovery binding={{ source, capability: adapter.capability }} />
