<script lang="ts">
	import RecoveryPhrase from 'delightful-local-first/recovery/svelte'
	import { createRecoveryMessages } from 'delightful-local-first/recovery/messages'
	import type {
		RecoveryScopeSource,
		RecoveryPhraseCapability
	} from 'delightful-local-first/recovery/contracts'
	import { getLocale } from '../../paraglide/runtime.js'
	let {
		binding
	}: { binding: { source: RecoveryScopeSource; capability: RecoveryPhraseCapability } } = $props()
	const messages = $derived(createRecoveryMessages(getLocale()))
</script>

<RecoveryPhrase source={binding.source} capability={binding.capability} {messages} />
