<script lang="ts">
	import type {
		RecoveryPhraseCapability,
		RecoveryScopeSource
	} from '../../contracts/recovery-phrase.js'
	import type { RecoveryMessages } from '../../contracts/recovery-messages.js'
	import RecoveryPhraseBinding from './RecoveryPhraseBinding.svelte'

	let { source, capability, messages }: {
		source: RecoveryScopeSource
		capability: RecoveryPhraseCapability
		messages: RecoveryMessages
	} = $props()
</script>

<!-- Keyed ownership replaces the entire actor lifetime when its fixed dependencies change. -->
{#key source}
	{#key capability}
		<RecoveryPhraseBinding {source} {capability} {messages} />
	{/key}
{/key}
