<script lang="ts">
	import type { Component, Snippet } from 'svelte'
	import type { SVGAttributes } from 'svelte/elements'

	type Props = SVGAttributes<SVGSVGElement> & {
		title?: string
		label?: string
		decorative?: boolean
		children?: Snippet
		icon?: Component<SVGAttributes<SVGSVGElement>>
	}

	let {
		icon: Glyph,
		label,
		decorative = true,
		children,
		'aria-hidden': ariaHidden,
		'aria-labelledby': ariaLabelledby,
		role,
		title,
		viewBox = '0 0 24 24',
		preserveAspectRatio = 'xMidYMid meet',
		width = '1em',
		height = '1em',
		class: className,
		...attributes
	}: Props = $props()

	let isDecorative = $derived(
		decorative && !label && !ariaLabelledby && !title && ariaHidden !== 'false'
	)
	const svgAttributes = $derived<SVGAttributes<SVGSVGElement>>({
		...attributes,
		class: ['dui-icon', className],
		role: isDecorative ? undefined : (role ?? 'img'),
		'aria-hidden': isDecorative ? 'true' : ariaHidden,
		'aria-label': label ?? (Glyph ? title : undefined),
		'aria-labelledby': ariaLabelledby,
		focusable: 'false',
		viewBox,
		preserveAspectRatio,
		width,
		height
	})
</script>

{#if Glyph}
	<Glyph {...svgAttributes} />
{:else}
	<svg
		{...svgAttributes}
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
	>
		{#if title && !isDecorative}
			<title>{title}</title>
		{/if}
		{@render children?.()}
	</svg>
{/if}

<style>
	:global(.dui-icon) {
		display: block;
		flex-shrink: 0;
	}
</style>
