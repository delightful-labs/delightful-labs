<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte'
	import type { HTMLDetailsAttributes } from 'svelte/elements'
	import Details from './Details.svelte'
	import Icon from './Icon.svelte'

	let {
		label,
		icon,
		open = $bindable(false),
		children,
		...attributes
	}: Omit<HTMLDetailsAttributes, 'open' | 'children'> & {
		label: string
		icon?: ComponentProps<typeof Icon>['icon']
		open?: boolean
		children: Snippet
	} = $props()
</script>

<div class="navigation-group">
	<Details {...attributes} bind:open caretPosition="right">
		{#snippet summary()}
			<span class="group-label">
				{#if icon}<Icon {icon} width="1.25em" height="1.25em" />{/if}
				<span>{label}</span>
			</span>
		{/snippet}
		{#snippet content()}
			<div class="group-content">{@render children()}</div>
		{/snippet}
	</Details>
</div>

<style>
	.navigation-group {
		--dui-details-border-width: 0;
		--dui-details-summary-padding: var(
			--dui-navigation-item-padding,
			0.5rem 1rem
		);
		min-inline-size: 0;
	}
	.group-label {
		display: flex;
		align-items: center;
		gap: var(--dui-navigation-item-gap, 0.5rem);
		overflow-wrap: anywhere;
	}
	.group-label > span {
		min-inline-size: 0;
	}
	.group-content {
		display: grid;
		gap: var(--dui-space-xs, 0.5rem);
		min-inline-size: 0;
	}
</style>
