<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getReadiness } from '#lib/runtime/bank-sync.js'
	import { m } from '#lib/paraglide/messages.js'
	let { waitingForOtherVersion = false }: { waitingForOtherVersion?: boolean } = $props()
	import JazzStartup from './JazzStartup.svelte'
	const readiness = getReadiness()
	const state = fromStore(readiness.snapshot)
</script>

<JazzStartup
	error={state.current.hasTag('startup-error')}
	message={waitingForOtherVersion ? m['database.version_conflict']() : undefined}
	onRetry={() => readiness.actor.send({ type: 'RETRY' })}
/>
