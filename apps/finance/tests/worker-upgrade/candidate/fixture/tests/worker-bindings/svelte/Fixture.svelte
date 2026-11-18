<script lang="ts">
	import { JazzProvider } from 'jazz-tools/svelte'
	import type { JazzClient, JazzSession } from 'jazz-tools/client'
	import RecoveryPhraseIntegration from '../../../src/lib/components/identity/RecoveryPhraseIntegration.svelte'

	let { session }: { session: JazzSession<JazzClient> } = $props()
</script>

{#snippet loading()}<p role="status">Session loading</p>{/snippet}
{#snippet signedOut()}<p role="status">Session signed out</p>{/snippet}
{#snippet closed()}<p role="status">Session closed</p>{/snippet}

<JazzProvider {session} {loading} {signedOut} {closed}>
	<RecoveryPhraseIntegration />
</JazzProvider>
