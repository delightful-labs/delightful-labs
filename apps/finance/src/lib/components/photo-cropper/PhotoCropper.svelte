<script lang="ts">
	import { onMount } from 'svelte'
	import { Button } from 'delightful-ui'
	import { createActor, type SnapshotFrom, type ActorFromLogic } from 'xstate'
	import { m } from '#lib/paraglide/messages.js'
	import { photoCropperMachine } from './machine.js'
	import CropperHandles from './CropperHandles.svelte'
	import { keyboardNudge, sourcePointFromPointer } from './interaction.js'
	import type { CropCorner } from './machine.js'

	let {
		file,
		aspectRatio = 1,
		mask = 'none',
		oncomplete,
		oncancel
	}: {
		file: File
		aspectRatio?: number
		mask?: 'none' | 'circle'
		oncomplete: (file: File) => void
		oncancel: () => void
	} = $props()
	let viewport = $state<HTMLElement>()
	let dimensions = $state({ width: 1, height: 1 })
	let snapshot = $state<SnapshotFrom<typeof photoCropperMachine>>()
	let actor: ActorFromLogic<typeof photoCropperMachine> | undefined
	let subscription: { unsubscribe: () => void } | undefined
	let error = $state(false)
	let bitmap = $derived(snapshot?.context.bitmap)
	let crop = $derived(snapshot?.context.crop)
	let imageSize = $derived(snapshot?.context.imageSize)
	let viewportReady = $derived(dimensions.width > 0 && dimensions.height > 0)
	let busy = $derived(
		snapshot?.matches('loading') || snapshot?.matches('cropping') || snapshot?.matches('closing')
	)
	let imageUrl = $state('')
	let resizeObserver: ResizeObserver | undefined

	function start() {
		if (!viewport) return
		const bounds = viewport.getBoundingClientRect()
		dimensions = { width: bounds.width, height: bounds.height }
		imageUrl = URL.createObjectURL(file)
		actor = createActor(photoCropperMachine, { input: { file, aspectRatio } })
		subscription = actor.subscribe((value) => {
			snapshot = value
			if (value.status !== 'done') return
			if (value.matches('failed')) error = true
			else if (value.output.kind === 'cropped') oncomplete(value.output.file)
			else oncancel()
		})
		actor.start()
	}
	function stop() {
		resizeObserver?.disconnect()
		subscription?.unsubscribe()
		actor?.stop()
		URL.revokeObjectURL(imageUrl)
		subscription = undefined
		actor = undefined
	}
	function sendPointer(
		type: 'POINTER_DOWN' | 'POINTER_MOVE' | 'POINTER_UP',
		event: PointerEvent,
		mode: 'move' | 'resize' = 'move',
		corner?: CropCorner
	) {
		if (actor?.getSnapshot().status !== 'active') return
		const bounds = viewport?.getBoundingClientRect()
		const image = imageSize
		if (type === 'POINTER_DOWN' && event.currentTarget instanceof Element) {
			event.currentTarget.setPointerCapture(event.pointerId)
		}
		if (type === 'POINTER_UP') actor?.send({ type })
		else if (bounds && image) {
			const pointer = sourcePointFromPointer(event, bounds, image)
			if (type === 'POINTER_MOVE') actor?.send({ type, point: pointer })
			else if (mode === 'resize' && corner) actor?.send({ type, point: pointer, mode, corner })
			else actor?.send({ type, point: pointer, mode: 'move' })
		}
	}
	function cancel() {
		if (actor?.getSnapshot().status === 'active') actor.send({ type: 'CANCEL' })
		else oncancel()
	}
	function nudge(event: KeyboardEvent, mode: 'move' | 'resize', corner?: CropCorner) {
		const bounds = viewport?.getBoundingClientRect()
		if (!bounds || !imageSize || actor?.getSnapshot().status !== 'active') return
		const command = keyboardNudge(event.key, event.shiftKey, imageSize, bounds, mode, corner)
		if (!command) return
		event.preventDefault()
		actor.send(command)
	}
	onMount(() => {
		if (viewport) {
			resizeObserver = new ResizeObserver(([entry]) => {
				if (entry) dimensions = { width: entry.contentRect.width, height: entry.contentRect.height }
			})
			resizeObserver.observe(viewport)
		}
		start()
		return stop
	})
</script>

<section class="cropper" aria-label={m['profile.crop_instruction']()}>
	<div
		bind:this={viewport}
		class="viewport"
		role="application"
		aria-label={m['profile.crop_instruction']()}
		onpointerdown={(event) => sendPointer('POINTER_DOWN', event)}
		onpointermove={(event) => sendPointer('POINTER_MOVE', event)}
		onpointerup={(event) => sendPointer('POINTER_UP', event)}
		onpointercancel={(event) => sendPointer('POINTER_UP', event)}
	>
		{#if bitmap && imageSize && viewportReady}
			{@const scale = Math.min(
				dimensions.width / imageSize.width,
				dimensions.height / imageSize.height
			)}
			<img alt={m['nouns.image']({ count: 1 })} src={imageUrl} />
			{#if crop}
				<div
					class="crop"
					style={`left:calc(50% - ${(imageSize.width * scale) / 2}px + ${crop.x * scale}px);top:${crop.y * scale}px;width:${crop.width * scale}px;height:${crop.height * scale}px`}
				>
					{#if mask === 'circle'}
						<div class="mask circle" aria-hidden="true"></div>
					{/if}
					<button
						type="button"
						class="reposition"
						aria-label={m['profile.crop_reposition']()}
						onkeydown={(event) => nudge(event, 'move')}
					>
						{m['profile.crop_reposition']()}
					</button>
					<CropperHandles
						onpointerdown={(event, corner) => {
							event.stopPropagation()
							sendPointer('POINTER_DOWN', event, 'resize', corner)
						}}
						onkeydown={(event, corner) => nudge(event, 'resize', corner)}
					/>
				</div>
			{/if}
		{/if}
	</div>
	{#if error || snapshot?.matches('failed')}
		<p role="alert">{m['profile.crop_failed']()}</p>
	{/if}
	<div class="actions">
		<Button type="button" disabled={busy} onclick={cancel}>
			{m['actions.cancel']()}
		</Button>
		<Button
			type="button"
			variant="primary"
			disabled={busy || !snapshot?.matches('ready')}
			onclick={() => actor?.send({ type: 'CROP' })}
		>
			{m['profile.crop_apply']()}
		</Button>
	</div>
</section>

<style>
	.viewport {
		position: relative;
		width: min(100%, 24rem);
		aspect-ratio: 1;
		touch-action: none;
	}
	.viewport img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		object-position: top center;
		user-select: none;
		pointer-events: none;
	}
	.crop {
		position: absolute;
		box-sizing: border-box;
		border: 2px dashed currentColor;
		cursor: move;
	}
	.crop .mask {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		background: var(--dui-color-foreground, #000);
		opacity: var(--dui-photo-cropper-mask-opacity, 0.45);
	}
	.crop .mask.circle {
		-webkit-mask-image: radial-gradient(
			circle closest-side,
			transparent calc(100% - 1px),
			#000 100%
		);
		mask-image: radial-gradient(circle closest-side, transparent calc(100% - 1px), #000 100%);
	}
	.crop :global(.handle) {
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
	.crop :global(.reposition) {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 2;
		width: 1px;
		height: 1px;
		min-width: 0;
		min-height: 0;
		padding: 0;
		clip-path: inset(50%);
		overflow: hidden;
		white-space: nowrap;
	}
	.crop :global(.reposition:focus-visible) {
		width: auto;
		height: auto;
		min-height: var(--dui-button-min-height, 44px);
		padding: var(--dui-spacing-xxs, 0.25rem);
		clip-path: none;
		overflow: visible;
		color: var(--dui-button-color, var(--dui-color-foreground, currentColor));
		background: var(--dui-button-background-color, var(--dui-color-background, Canvas));
	}
	.cropper {
		display: grid;
		justify-items: center;
		gap: var(--dui-space-md, var(--dui-spacing-md, 1rem));
	}
	.actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem));
	}
</style>
