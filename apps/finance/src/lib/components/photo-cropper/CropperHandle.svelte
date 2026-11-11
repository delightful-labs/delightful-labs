<script lang="ts">
	import type { CropCorner } from './machine.js'

	let {
		corner,
		label,
		style,
		onpointerdown,
		onkeydown
	}: {
		corner: CropCorner
		label: string
		style: string
		onpointerdown: (event: PointerEvent, corner: CropCorner) => void
		onkeydown: (event: KeyboardEvent, corner: CropCorner) => void
	} = $props()
</script>

<button
	type="button"
	class="handle"
	{style}
	aria-label={label}
	onkeydown={(event) => onkeydown(event, corner)}
	onpointerdown={(event) => onpointerdown(event, corner)}
></button>

<style>
	.handle {
		position: absolute;
		width: 0.875rem;
		height: 0.875rem;
		box-sizing: border-box;
		min-width: 0;
		min-height: 0;
		padding: 0;
		border: 2px solid currentColor;
		border-radius: 50%;
		background: Canvas;
		touch-action: none;
	}
</style>
