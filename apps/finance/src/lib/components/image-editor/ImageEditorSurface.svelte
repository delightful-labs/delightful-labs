<script lang="ts">
	import { selectionQuad, type ImageSelection } from '#lib/domain/image-editor-geometry.js'
	import type { ImageAdjustments } from '#lib/domain/image-editor-pixels.js'
	import type { ImageEditorEvent } from '#lib/machines/images/image-editor.js'
	import { paintEditorCanvas } from '#lib/domain/image-editor-platform.js'
	import { m } from '#lib/paraglide/messages.js'
	import CropperHandle from '../photo-cropper/CropperHandle.svelte'
	import { sourcePointFromPointer, keyboardNudge } from '../photo-cropper/interaction.js'
	import type { ImageCorner } from '#lib/domain/image-editor-geometry.js'

	let {
		pixels,
		selection,
		adjustments,
		enabled = false,
		oncommand
	}: {
		pixels: ImageData
		selection?: ImageSelection
		adjustments?: ImageAdjustments
		enabled?: boolean
		oncommand: (event: ImageEditorEvent) => void
	} = $props()
	let viewport = $state<HTMLDivElement>()
	let canvas = $state<HTMLCanvasElement>()
	const raster = $derived(pixels)
	const quad = $derived(selection ? selectionQuad(selection) : undefined)
	const corners = $derived(
		quad
			? ([
					{ corner: 'topLeft', point: quad.topLeft, label: m['image_editor.resize_top_left']() },
					{ corner: 'topRight', point: quad.topRight, label: m['image_editor.resize_top_right']() },
					{
						corner: 'bottomRight',
						point: quad.bottomRight,
						label: m['image_editor.resize_bottom_right']()
					},
					{
						corner: 'bottomLeft',
						point: quad.bottomLeft,
						label: m['image_editor.resize_bottom_left']()
					}
				] satisfies { corner: ImageCorner; point: { x: number; y: number }; label: string }[])
			: []
	)
	$effect(() => {
		if (!canvas) return
		try {
			paintEditorCanvas(canvas, raster)
		} catch {
			oncommand({ type: 'DISPLAY_FAILED' })
		}
	})
	function begin(event: PointerEvent, corner?: ImageCorner) {
		if (!enabled || !viewport || event.button !== 0) return
		if (event.currentTarget instanceof Element)
			event.currentTarget.setPointerCapture(event.pointerId)
		event.stopPropagation()
		oncommand({
			type: 'BEGIN_DRAG',
			point: sourcePointFromPointer(event, viewport.getBoundingClientRect(), pixels),
			target: corner ? { kind: 'corner', corner } : { kind: 'move' }
		})
	}
	function drag(event: PointerEvent) {
		if (enabled && viewport)
			oncommand({
				type: 'DRAG',
				point: sourcePointFromPointer(event, viewport.getBoundingClientRect(), pixels)
			})
	}
	function nudge(event: KeyboardEvent, corner?: ImageCorner) {
		if (!enabled || !viewport) return
		const command = keyboardNudge(
			event.key,
			event.shiftKey,
			pixels,
			viewport.getBoundingClientRect(),
			corner ? 'resize' : 'move',
			corner
		)
		if (!command) return
		event.preventDefault()
		oncommand({
			type: 'NUDGE',
			delta: command.delta,
			target: corner ? { kind: 'corner', corner } : { kind: 'move' }
		})
	}
</script>

<div
	bind:this={viewport}
	class="viewport"
	style:aspect-ratio={`${pixels.width} / ${pixels.height}`}
	style:--image-ratio={pixels.width / pixels.height}
	role="application"
	aria-label={m['image_editor.instructions']()}
	onpointerdown={(event) => begin(event)}
	onpointermove={drag}
	onpointerup={() => oncommand({ type: 'END_DRAG' })}
	onpointercancel={() => oncommand({ type: 'END_DRAG' })}
	onlostpointercapture={() => oncommand({ type: 'END_DRAG' })}
>
	<canvas
		bind:this={canvas}
		aria-label={m['image_editor.image']()}
		style:filter={`grayscale(${adjustments?.blackWhite ? 1 : 0}) contrast(${(adjustments?.contrast ?? 100) / 100})`}
	></canvas>
	{#if quad}
		<svg viewBox={`0 0 ${pixels.width} ${pixels.height}`} aria-hidden="true">
			<polygon points={corners.map(({ point }) => `${point.x},${point.y}`).join(' ')} />
		</svg>
		{#if enabled}
			<button
				type="button"
				class="reposition"
				aria-label={m['image_editor.reposition']()}
				onkeydown={(event) => nudge(event)}
			>
				{m['image_editor.reposition']()}
			</button>
			{#each corners as { corner, point, label } (corner)}
				<CropperHandle
					{corner}
					{label}
					style={`left:${(point.x / pixels.width) * 100}%;top:${(point.y / pixels.height) * 100}%;transform:translate(-50%,-50%);cursor:move`}
					onpointerdown={(event) => begin(event, corner)}
					onkeydown={(event) => nudge(event, corner)}
				/>
			{/each}
		{/if}
	{/if}
</div>

<style>
	.viewport {
		position: relative;
		width: min(100%, 24rem, calc(55dvh * var(--image-ratio)));
		touch-action: none;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}
	polygon {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-dasharray: 6 4;
		vector-effect: non-scaling-stroke;
	}
	.reposition {
		position: absolute;
		inset-block-start: 0;
		inset-inline-start: 0;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
	}
	.reposition:focus-visible {
		width: auto;
		height: auto;
		min-height: var(--dui-button-min-height, 44px);
		padding: var(--dui-spacing-xxs, 0.25rem);
		clip-path: none;
		background: Canvas;
		z-index: 1;
	}
</style>
