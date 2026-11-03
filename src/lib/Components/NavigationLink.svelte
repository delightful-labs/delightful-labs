<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte'
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import Icon from './Icon.svelte'

	let {
		icon,
		children,
		trailing,
		class: className,
		...attributes
	}: Omit<HTMLAnchorAttributes, 'children'> & {
		icon?: ComponentProps<typeof Icon>['icon']
		children: Snippet
		/** Non-interactive supplementary content, such as a count. */
		trailing?: Snippet
	} = $props()
</script>

<a {...attributes} class={['navigation-link', className]}>
	{#if icon}<Icon {icon} width="1.25em" height="1.25em" />{/if}
	<span class="label">{@render children()}</span>
	{#if trailing}<span class="trailing">{@render trailing()}</span>{/if}
</a>

<style>
	.navigation-link {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		gap: var(--dui-navigation-item-gap, 0.5rem);
		min-block-size: var(--dui-navigation-link-min-height, 44px);
		padding: var(--dui-navigation-item-padding, 0.5rem 1rem);
		font-family: var(--dui-font-family, inherit);
		overflow-wrap: anywhere;
	}
	.label {
		min-inline-size: 0;
	}
	.trailing {
		margin-inline-start: auto;
	}
	.navigation-link[aria-current='page'] {
		background: var(
			--dui-navigation-current-background,
			var(--dui-color-accent, #94ff47)
		);
		color: var(
			--dui-navigation-current-color,
			var(--dui-color-on-accent, #262626)
		);
		font-weight: var(--dui-navigation-current-font-weight, 600);
		text-decoration: none;
	}
	.navigation-link:focus-visible {
		outline: 2px dashed var(--dui-color-foreground, currentColor);
		outline-offset: -2px;
	}
</style>
