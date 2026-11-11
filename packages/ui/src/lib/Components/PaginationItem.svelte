<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements'

	type Props = Omit<HTMLAnchorAttributes, 'aria-current'> & {
		label: string
		current?: boolean
		disabled?: boolean
		ellipsis?: boolean
		children?: import('svelte').Snippet
	}

	let {
		label,
		current = false,
		disabled = false,
		ellipsis = false,
		children,
		class: className,
		...attributes
	}: Props = $props()
</script>

<li>
	{#if ellipsis}
		<span class={['ellipsis', className]} aria-hidden="true">
			{@render children?.()}
		</span>
	{:else if disabled}
		<span class={['item', className]} aria-label={label} aria-disabled="true">
			{@render children?.()}
		</span>
	{:else}
		<a
			{...attributes}
			class={['item', className]}
			aria-label={label}
			aria-current={current ? 'page' : undefined}
		>
			{@render children?.()}
		</a>
	{/if}
</li>

<style>
	@property --dui-pagination-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-pagination-control-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-pagination-current-background {
		syntax: '*';
		inherits: true;
	}

	@property --dui-pagination-current-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-pagination-focus-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-pagination-hover-background {
		syntax: '*';
		inherits: true;
	}

	@property --dui-pagination-item-padding {
		syntax: '*';
		inherits: true;
	}

	.item,
	.ellipsis {
		box-sizing: border-box;
		display: grid;
		place-items: center;
		min-inline-size: var(--dui-pagination-control-size, 2.75rem);
		min-block-size: var(--dui-pagination-control-size, 2.75rem);
		padding: var(
			--dui-pagination-item-padding,
			var(--dui-spacing-xxs, 0.25rem)
		);
		border: 1px solid var(--dui-pagination-border-color, currentColor);
		border-radius: 0;
		color: inherit;
		font: inherit;
		font-family: var(
			--dui-font-family-interactive,
			'Cascadia Code',
			ui-monospace,
			monospace
		);
		text-decoration: none;
	}

	a.item:hover:not([aria-current='page']) {
		background: var(
			--dui-pagination-hover-background,
			color-mix(in srgb, currentColor 10%, transparent)
		);
	}

	a.item[aria-current='page'] {
		color: var(
			--dui-pagination-current-color,
			var(--dui-color-on-accent, #000)
		);
		background: var(
			--dui-pagination-current-background,
			var(--dui-color-accent, #94ff47)
		);
		font-weight: 700;
	}

	a.item:focus-visible {
		outline: 2px solid
			var(--dui-pagination-focus-color, var(--dui-color-focus, currentColor));
		outline-offset: 2px;
	}

	.item[aria-disabled='true'] {
		opacity: 0.5;
	}

	.ellipsis {
		border-color: transparent;
	}

	@media (forced-colors: active) {
		a.item[aria-current='page'] {
			outline: 2px solid currentColor;
			outline-offset: -4px;
		}
	}
</style>
