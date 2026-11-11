<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'

	type Props = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
		sticky?: boolean
		children?: Snippet
		class?: string
	}

	let {
		sticky = false,
		children,
		class: className,
		...attributes
	}: Props = $props()
</script>

<header
	{...attributes}
	class={['top-navigation', className]}
	data-sticky={sticky}
	data-top-navigation
	data-top-navigation-root
>
	{@render children?.()}
</header>

<style>
	@property --dui-top-navigation-background {
		syntax: '*';
		inherits: true;
	}

	@property --dui-top-navigation-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-top-navigation-border-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-top-navigation-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-top-navigation-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-top-navigation-height {
		syntax: '*';
		inherits: true;
	}

	@property --dui-top-navigation-padding {
		syntax: '*';
		inherits: true;
	}

	.top-navigation {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: var(
			--dui-top-navigation-gap,
			var(--dui-space-sm, var(--dui-spacing-md, 1rem))
		);
		min-block-size: var(--dui-top-navigation-height, 3.5rem);
		box-sizing: border-box;
		padding: var(
			--dui-top-navigation-padding,
			var(--dui-spacing-xs, 0.5rem) var(--dui-spacing-md, 1rem)
		);
		color: var(
			--dui-top-navigation-color,
			var(--dui-color-foreground, inherit)
		);
		background: var(
			--dui-top-navigation-background,
			var(--dui-color-background, transparent)
		);
		border-block-end: var(
				--dui-top-navigation-border-width,
				var(--dui-border-width, 2px)
			)
			solid
			var(
				--dui-top-navigation-border-color,
				var(--dui-color-foreground, currentColor)
			);
	}

	.top-navigation[data-sticky='true'] {
		position: sticky;
		inset-block-start: 0;
	}

	.top-navigation :global([data-top-navigation-spacer]) {
		flex: 1;
	}
</style>
