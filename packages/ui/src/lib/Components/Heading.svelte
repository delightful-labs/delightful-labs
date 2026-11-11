<script lang="ts">
	import type { Snippet } from 'svelte'
	import {
		fontSizeTokens,
		type TypographySize,
		type TypographyAlign
	} from '../typography.js'
	import type { HTMLAttributes } from 'svelte/elements'

	type Level = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
	type Props = Omit<HTMLAttributes<HTMLHeadingElement>, 'children'> & {
		level?: Level
		size?: TypographySize
		align?: TypographyAlign
		children: Snippet
	}

	let {
		level = 'h2',
		size,
		align,
		children,
		class: className,
		...attributes
	}: Props = $props()
	const sizes: Record<Level, TypographySize> = {
		h1: 'xxl',
		h2: 'xl',
		h3: 'lg',
		h4: 'md',
		h5: 'sm',
		h6: 'xs'
	}
	const resolvedSize = $derived(size ?? sizes[level])
</script>

<svelte:element
	this={level}
	{...attributes}
	class={['heading', className]}
	style:--_dui-heading-size={fontSizeTokens[resolvedSize]}
	style:--_dui-heading-align={align ?? 'initial'}
	data-size={resolvedSize}
	data-align={align}
>
	{@render children()}
</svelte:element>

<style>
	@property --dui-heading-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-heading-font-family {
		syntax: '*';
		inherits: true;
	}

	@property --dui-heading-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-heading-font-weight {
		syntax: '<number> | normal | bold | bolder | lighter';
		inherits: true;
		initial-value: 600;
	}

	@property --dui-heading-line-height {
		syntax: '<number> | <length-percentage> | normal';
		inherits: true;
		initial-value: 1.3;
	}

	.heading {
		margin: 0;
		font-size: var(--dui-heading-font-size, var(--_dui-heading-size));
		text-align: var(--_dui-heading-align, inherit);
		font-family: var(
			--dui-heading-font-family,
			var(--dui-font-family, inherit)
		);
		font-weight: var(--dui-heading-font-weight, 600);
		line-height: var(--dui-heading-line-height, 1.3);
		color: var(--dui-heading-color, var(--dui-color-foreground, inherit));
		overflow-wrap: anywhere;
	}
</style>
