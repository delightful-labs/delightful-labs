<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import { Button } from 'delightful-ui'
	import type { MutationNotice } from '#lib/machines/runtime/application-readiness.js'

	let { notice, onDismiss }: { notice: MutationNotice | undefined; onDismiss: () => void } =
		$props()
</script>

<p role="status" aria-live="polite" aria-atomic="true">
	{#if notice}
		{m['sync.mutation_rejected']()}
		<Button type="button" onclick={onDismiss}>{m['actions.dismiss']()}</Button>
	{/if}
</p>

<style>
	p {
		margin: 0;
	}
</style>
