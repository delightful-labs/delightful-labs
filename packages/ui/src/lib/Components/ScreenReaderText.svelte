<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements'

	let {
		class: className,
		children,
		...attributes
	}: HTMLAttributes<HTMLSpanElement> = $props()
</script>

<span {...attributes} class={['screen-reader-text', className]}>
	{@render children?.()}
</span>

<style>
	.screen-reader-text {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		margin: -1px;
		padding: 0;
		border: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
