<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements'

	type Props = Omit<HTMLAttributes<HTMLElement>, 'aria-label'> & {
		label: string
		orientation?: 'horizontal' | 'vertical'
	}

	let {
		label,
		orientation = 'vertical',
		children,
		class: className,
		...attributes
	}: Props = $props()
</script>

<nav
	{...attributes}
	aria-label={label}
	class={[
		'navigation',
		className,
		{ horizontal: orientation === 'horizontal' }
	]}
>
	<ul>
		{@render children?.()}
	</ul>
</nav>

<style>
	@property --dui-navigation-current-font-weight {
		syntax: '<number> | normal | bold | bolder | lighter';
		inherits: true;
		initial-value: 600;
	}

	@property --dui-navigation-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-navigation-link-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 44px;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(
			--dui-navigation-gap,
			var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem))
		);
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.horizontal > ul {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
	}

	.navigation :global(a),
	.navigation :global(button[popovertarget]) {
		display: flex;
		align-items: center;
		min-block-size: var(--dui-navigation-link-min-height, 44px);
		overflow-wrap: anywhere;
	}

	.navigation :global(button[popovertarget]) {
		gap: var(--dui-spacing-xxs, 0.25rem);
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
		font: inherit;
		color: inherit;
		text-decoration: underline;
		text-decoration-color: var(--dui-color-accent, #94ff47);
		text-decoration-thickness: 2px;
		text-underline-offset: 0.2em;
		cursor: pointer;
	}

	.navigation :global(button[popovertarget]:hover) {
		text-decoration-style: dashed;
	}

	.navigation :global(a[aria-current='page']) {
		font-weight: var(--dui-navigation-current-font-weight, 600);
	}

	.navigation :global(summary:focus-visible),
	.navigation :global(a:focus-visible),
	.navigation :global(button[popovertarget]:focus-visible) {
		outline: 2px dashed var(--dui-color-foreground, currentColor);
		outline-offset: -2px;
	}
</style>
