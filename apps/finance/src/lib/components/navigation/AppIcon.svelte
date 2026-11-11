<script lang="ts">
	import type { Component } from 'svelte'
	import type { SVGAttributes } from 'svelte/elements'

	let {
		icon: Glyph,
		navigation = false,
		class: className,
		...attributes
	}: SVGAttributes<SVGSVGElement> & {
		icon: Component<SVGAttributes<SVGSVGElement>>
		navigation?: boolean
	} = $props()
</script>

<Glyph
	{...attributes}
	class={['app-icon', { 'navigation-icon': navigation }, className]}
	viewBox="0 0 24 24"
	width="1em"
	height="1em"
	aria-hidden="true"
	focusable="false"
/>

<style>
	:global {
		.app-icon {
			display: inline-block;
			flex-shrink: 0;
			vertical-align: middle;
		}

		.app-icon.navigation-icon {
			inline-size: 1.25rem;
			block-size: 1.25rem;
			margin-inline-end: var(--dui-space-xs, 0.5rem);
		}
	}
</style>
