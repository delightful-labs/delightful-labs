<script lang="ts">
	import type { Snippet } from 'svelte'
	import {
		fontSizeTokens,
		type TypographySize,
		type TypographyAlign
	} from '../typography.js'
	import type { HTMLAttributes } from 'svelte/elements'

	type Props = Omit<
		HTMLAttributes<HTMLParagraphElement | HTMLSpanElement>,
		'children'
	> & {
		as?: 'p' | 'span'
		size?: TypographySize
		align?: TypographyAlign
		children: Snippet
	}

	let {
		as = 'p',
		size = 'md',
		align,
		children,
		class: className,
		...attributes
	}: Props = $props()
</script>

<svelte:element
	this={as}
	{...attributes}
	class={['text', className]}
	style:--_dui-text-size={fontSizeTokens[size]}
	style:--_dui-text-align={align ?? 'initial'}
	data-size={size}
	data-align={align}
>
	{@render children()}
</svelte:element>

<style>
	@property --dui-text-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-text-font-family {
		syntax: '*';
		inherits: true;
	}

	@property --dui-text-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-text-line-height {
		syntax: '<number> | <length-percentage> | normal';
		inherits: true;
		initial-value: 1.5;
	}

	.text {
		margin: 0;
		font-size: var(--dui-text-font-size, var(--_dui-text-size));
		text-align: var(--_dui-text-align, inherit);
		font-family: var(
			--dui-text-font-family,
			var(--dui-font-family-body, inherit)
		);
		line-height: var(--dui-text-line-height, 1.5);
		color: var(--dui-text-color, var(--dui-color-foreground, inherit));
	}
</style>
