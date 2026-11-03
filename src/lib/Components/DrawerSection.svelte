<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'

	let {
		element = 'div',
		children,
		class: className,
		...attributes
	}: Omit<HTMLAttributes<HTMLElement>, 'children'> & {
		element?: 'div' | 'section'
		children: Snippet
	} = $props()
</script>

<svelte:element
	this={element}
	{...attributes}
	class={['drawer-section', className]}
>
	{@render children()}
</svelte:element>

<style>
	.drawer-section {
		display: grid;
		gap: var(--dui-drawer-section-gap, var(--dui-space-xs, 0.5rem));
		min-inline-size: 0;
		padding: var(--dui-drawer-section-padding, 0.5rem 1rem);
	}
</style>
