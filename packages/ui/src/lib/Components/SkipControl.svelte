<script lang="ts">
	import type { Component } from 'svelte'
	import type {
		HTMLAnchorAttributes,
		HTMLButtonAttributes
	} from 'svelte/elements'

	type Props =
		| (HTMLAnchorAttributes & { component?: undefined; href: string })
		| (HTMLButtonAttributes & { component: Component<HTMLButtonAttributes> })

	let props: Props = $props()
</script>

<span class="skip-control">
	{#if props.component}
		{@const { component: Control, children, ...attributes } = props}
		<Control {...attributes}>{@render children?.()}</Control>
	{:else}
		{@const { children, ...attributes } = props}
		<a {...attributes}>{@render children?.()}</a>
	{/if}
</span>

<style>
	.skip-control > :global(:is(a, button)) {
		font-family: var(
			--dui-font-family-interactive,
			'Cascadia Code',
			ui-monospace,
			monospace
		);
	}

	.skip-control {
		position: fixed;
		inset-block-start: var(--dui-spacing-xs, 0.5rem);
		inset-inline-start: var(--dui-spacing-xs, 0.5rem);
		z-index: 100;
		background-color: var(--dui-color-background, #fff);
	}

	.skip-control:not(:focus-within) {
		inline-size: 1px;
		block-size: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
