<script lang="ts">
	import { Button } from 'delightful-ui'
	import type { PwaUpdateView } from '#lib/machines/pwa/pwa-update.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		view,
		onUpdate,
		onLater
	}: {
		view: PwaUpdateView
		onUpdate: () => void
		onLater: () => void
	} = $props()
</script>

<div>
	<p role="status">
		{#if view !== 'hidden'}
			{view === 'failed'
				? m['pwa_update.failed']()
				: view === 'busy'
					? m['pwa_update.busy']()
					: view === 'reload'
						? m['pwa_update.activated']()
						: m['pwa_update.available']()}
		{/if}
	</p>
	{#if view !== 'hidden'}
		<Button disabled={view === 'busy'} onclick={onUpdate}>
			{view === 'failed' ? m['actions.retry']() : m['pwa_update.accept']()}
		</Button>
		{#if view !== 'busy'}
			<Button onclick={onLater}>{m['pwa_update.later']()}</Button>
		{/if}
	{/if}
</div>

<style>
	p {
		margin: 0;
	}
</style>
