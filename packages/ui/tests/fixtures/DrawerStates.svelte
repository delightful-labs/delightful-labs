<script lang="ts">
	import Drawer from '#lib/Components/Drawer.svelte'
	let {
		initialOpen = false,
		showCloseButton = true,
		longContent = false
	}: {
		initialOpen?: boolean
		showCloseButton?: boolean
		longContent?: boolean
	} = $props()
	let open = $state((() => initialOpen)())
</script>

<button
	id="drawer-toggle"
	aria-controls="drawer-panel"
	aria-expanded={open}
	onclick={() => (open = !open)}>Toggle drawer</button
>
<div class="layout">
	<Drawer
		heading="Fixture menu"
		closeLabel="Close menu"
		id="drawer-panel"
		{showCloseButton}
		style="--dui-drawer-width: 16rem; --dui-drawer-height: 24rem"
		bind:open
	>
		<div class="links">
			<a href="#accounts">Accounts</a>
			{#if longContent}
				{#each Array.from({ length: 40 }, (_, i) => i) as i (i)}
					<a href={`#section-${i}`}>Section {i}</a>
				{/each}
			{/if}
		</div>
	</Drawer>
	<button onclick={() => (open = false)}>Close externally</button>
</div>

<style>
	.layout {
		display: flex;
		gap: 1rem;
	}
	.links {
		display: grid;
		gap: 0.5rem;
	}
</style>
