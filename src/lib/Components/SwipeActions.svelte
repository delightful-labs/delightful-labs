<script lang="ts">
	import { onMount, tick } from 'svelte'
	import type { Snippet } from 'svelte'
	import { on } from 'svelte/events'
	import type { HTMLAttributes } from 'svelte/elements'
	import { createActor } from 'xstate'
	import ScreenReaderText from './ScreenReaderText.svelte'
	import {
		armedSwipeAction,
		swipeActionsMachine,
		swipeSide,
		type SwipeAction,
		type SwipeActionChosen,
		type SwipeSide
	} from './internal/swipe-actions.js'

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
		children: Snippet
		leftActions?: readonly SwipeAction[]
		rightActions?: readonly SwipeAction[]
		actionsLabel: string
		disabled?: boolean
		onactionchosen?: (choice: SwipeActionChosen) => void
	}

	let {
		children,
		leftActions = [],
		rightActions = [],
		actionsLabel,
		disabled = false,
		onactionchosen,
		class: className,
		...attributes
	}: Props = $props()

	const generatedId = $props.id()
	const trayId = `${generatedId}-actions`
	const actor = createActor(swipeActionsMachine, {
		input: { leftActions: [], rightActions: [], disabled: false }
	})
	let snapshot = $state(actor.getSnapshot())
	let root = $state<HTMLDivElement>()
	let surface = $state<HTMLDivElement>()
	let trays = $state<HTMLDivElement>()
	let trayElements = $state<{
		left: HTMLDivElement | undefined
		right: HTMLDivElement | undefined
	}>({ left: undefined, right: undefined })
	const dragging = $derived(snapshot.matches('dragging'))
	const dismissing = $derived(snapshot.matches({ dismissal: 'animating' }))
	const dismissed = $derived(snapshot.matches({ dismissal: 'complete' }))
	const revealed = $derived(snapshot.matches({ resting: 'open' }))
	const side = $derived(swipeSide(snapshot.context.offset))
	const armed = $derived(
		dragging ? armedSwipeAction(snapshot.context) : undefined
	)
	const selectedActionId = $derived(
		armed?.id ?? (dismissing ? snapshot.context.choice?.id : undefined)
	)
	const hasActions = $derived(
		[...leftActions, ...rightActions].some((action) => !action.disabled)
	)
	const sides = ['left', 'right'] as const

	/** Restore a retained row after dismissal, for example when an app undoes an action. */
	export function reset() {
		const pointer = actor.getSnapshot().context.pointerId
		actor.send({ type: 'RESET' })
		releasePointer(pointer)
	}

	$effect(() => {
		if (!dismissing || !surface) return
		const foreground = surface
		let cancelled = false
		void tick().then(async () => {
			if (cancelled) return
			const finalAction = trays?.querySelector('button[data-exiting="true"]')
			// CSS transitions expose native completion promises; no timers are needed.
			await Promise.allSettled(
				[
					...foreground.getAnimations(),
					...(finalAction?.getAnimations({ subtree: true }) ?? [])
				].map((animation) => animation.finished)
			)
			if (!cancelled) actor.send({ type: 'DISMISS_COMPLETE' })
		})
		return () => {
			cancelled = true
		}
	})

	$effect(() => {
		const pointer = actor.getSnapshot().context.pointerId
		actor.send({
			type: 'CONFIGURE',
			configuration: {
				leftActions: leftActions.map((action) => ({ ...action })),
				rightActions: rightActions.map((action) => ({ ...action })),
				disabled
			}
		})
		releasePointer(pointer)
	})

	function releasePointer(pointerId: number | null) {
		if (pointerId !== null && surface?.hasPointerCapture(pointerId)) {
			surface.releasePointerCapture(pointerId)
		}
	}

	function restoreFocus(previous = document.activeElement) {
		void tick().then(() => {
			if (
				root?.isConnected &&
				(document.activeElement === previous ||
					document.activeElement === document.body)
			) {
				const target = surface?.querySelector<HTMLElement>(
					'a[href],button:not(:disabled),input:not(:disabled),[tabindex]:not([tabindex="-1"])'
				)
				;(target ?? root).focus()
			}
		})
	}

	function close() {
		const active = document.activeElement
		const restore = Boolean(trays?.contains(active))
		const pointer = actor.getSnapshot().context.pointerId
		actor.send({ type: 'CLOSE' })
		releasePointer(pointer)
		if (restore) restoreFocus(active)
	}

	function choose(action: SwipeAction, actionSide: SwipeSide) {
		const active = document.activeElement
		actor.send({ type: 'CHOOSE', side: actionSide, id: action.id })
		restoreFocus(active)
	}

	onMount(() => {
		const element = root
		const foreground = surface
		if (!element || !foreground) return
		const subscription = actor.subscribe((next) => (snapshot = next))
		const chosen = actor.on('action.chosen', (event) =>
			onactionchosen?.(event.detail)
		)
		actor.start()

		function measure() {
			const pointer = actor.getSnapshot().context.pointerId
			actor.send({
				type: 'MEASURE',
				width: element!.clientWidth,
				leftWidth: trayElements.left?.getBoundingClientRect().width ?? 0,
				rightWidth: trayElements.right?.getBoundingClientRect().width ?? 0
			})
			if (actor.getSnapshot().context.pointerId === null)
				releasePointer(pointer)
		}
		const observer = new ResizeObserver(measure)
		observer.observe(element)
		measure()

		function cancel() {
			const pointer = actor.getSnapshot().context.pointerId
			actor.send({ type: 'CANCEL' })
			releasePointer(pointer)
		}
		function pointerDown(event: PointerEvent) {
			if (!event.isPrimary) {
				cancel()
				return
			}
			if (
				event.button !== 0 ||
				event.ctrlKey ||
				event.altKey ||
				event.metaKey ||
				event.shiftKey ||
				actor.getSnapshot().context.pointerId !== null
			)
				return
			const target = event.target
			if (
				!(target instanceof Element) ||
				target.closest(
					'button,input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[data-swipe-ignore]'
				)
			)
				return
			measure()
			actor.send({
				type: 'DOWN',
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY
			})
		}
		function pointerMove(event: PointerEvent) {
			if (event.pointerId !== actor.getSnapshot().context.pointerId) return
			actor.send({
				type: 'MOVE',
				pointerId: event.pointerId,
				x: event.clientX,
				y: event.clientY
			})
			if (actor.getSnapshot().matches('dragging')) {
				if (event.cancelable) event.preventDefault()
				if (!foreground!.hasPointerCapture(event.pointerId)) {
					foreground!.setPointerCapture(event.pointerId)
				}
			}
		}
		function pointerUp(event: PointerEvent) {
			if (event.pointerId !== actor.getSnapshot().context.pointerId) return
			pointerMove(event)
			actor.send({ type: 'UP', pointerId: event.pointerId })
			releasePointer(event.pointerId)
		}
		function suppressNavigation(event: MouseEvent) {
			if (event.detail === 0) return
			const current = actor.getSnapshot()
			if (current.context.blockClick) {
				event.preventDefault()
				event.stopImmediatePropagation()
				actor.send({ type: 'CONSUME_CLICK' })
			} else if (current.matches({ resting: 'open' })) {
				event.preventDefault()
				event.stopImmediatePropagation()
				close()
			}
		}
		const cleanups = [
			on(foreground, 'pointerdown', pointerDown),
			on(foreground, 'pointermove', pointerMove, { passive: false }),
			on(foreground, 'pointerup', pointerUp),
			on(foreground, 'pointercancel', cancel),
			on(foreground, 'lostpointercapture', (event) => {
				// Touch starts with implicit capture on the original child target.
				if (
					event.target === foreground &&
					event.pointerId === actor.getSnapshot().context.pointerId
				)
					cancel()
			}),
			on(foreground, 'contextmenu', cancel),
			on(foreground, 'dragstart', (event) => {
				if (actor.getSnapshot().context.pointerId !== null)
					event.preventDefault()
			}),
			on(foreground, 'click', suppressNavigation, { capture: true }),
			on(element, 'pointerdown', () => actor.send({ type: 'CONSUME_CLICK' }), {
				capture: true
			}),
			on(element, 'keydown', (event) => {
				if (event.defaultPrevented) return
				if (event.key === 'Escape' && (revealed || dragging)) {
					event.preventDefault()
					close()
					return
				}
				if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
					return
				const target = event.target
				if (
					!(target instanceof Element) ||
					target.closest(
						'button,input,select,textarea,[contenteditable]:not([contenteditable="false"])'
					)
				)
					return
				if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
				const actionSide = event.key === 'ArrowRight' ? 'left' : 'right'
				measure()
				actor.send({ type: 'REVEAL', side: actionSide })
				if (
					actor.getSnapshot().matches({ resting: 'open' }) &&
					swipeSide(actor.getSnapshot().context.offset) === actionSide
				) {
					event.preventDefault()
					void tick().then(() =>
						trayElements[actionSide]
							?.querySelector<HTMLButtonElement>('button:not(:disabled)')
							?.focus()
					)
				}
			}),
			on(
				document,
				'click',
				(event) => {
					if (
						(revealed || actor.getSnapshot().context.pointerId !== null) &&
						event.target instanceof Node &&
						!element.contains(event.target)
					)
						close()
				},
				{ capture: true }
			),
			on(document, 'focusin', (event) => {
				if (
					revealed &&
					event.target instanceof Node &&
					!element.contains(event.target)
				)
					close()
			}),
			on(window, 'blur', cancel),
			on(document, 'visibilitychange', () => {
				if (document.hidden) cancel()
			})
		]
		return () => {
			releasePointer(actor.getSnapshot().context.pointerId)
			observer.disconnect()
			for (const cleanup of cleanups) cleanup()
			chosen.unsubscribe()
			subscription.unsubscribe()
			actor.stop()
		}
	})
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (The group handles arrow keys to reveal its native action buttons.) -->
<div
	{...attributes}
	bind:this={root}
	class={['swipe-actions', className]}
	role="group"
	aria-label={attributes['aria-label'] ?? actionsLabel}
	tabindex={attributes.tabindex ?? -1}
	aria-keyshortcuts="ArrowLeft ArrowRight Escape"
	inert={dismissing || dismissed || attributes.inert}
	aria-hidden={dismissing || dismissed || attributes['aria-hidden']}
	hidden={dismissed || attributes.hidden}
	data-dragging={dragging}
	data-disabled={disabled || !hasActions}
>
	<div bind:this={trays} id={trayId} class="trays">
		{#each sides as actionSide (actionSide)}
			{@const actions = actionSide === 'left' ? leftActions : rightActions}
			{@const active = revealed && side === actionSide}
			<div
				bind:this={trayElements[actionSide]}
				class="tray"
				data-side={actionSide}
				data-visible={(dragging || revealed || dismissing) &&
					side === actionSide}
				inert={!active}
				aria-hidden={!active}
				style:--swipe-action-count={actions.length}
				style:--swipe-label-width={`min(var(--dui-swipe-action-width, 5.5rem), ${Math.max(0, snapshot.context.width - 44) / Math.max(1, actions.length)}px)`}
				style:min-inline-size={(dragging || dismissing) && side === actionSide
					? `${Math.abs(snapshot.context.offset)}px`
					: undefined}
			>
				{#each actions as action (action.id)}
					<button
						type="button"
						class="action"
						data-variant={action.variant ?? 'primary'}
						data-exiting={dismissing &&
							side === actionSide &&
							selectedActionId === action.id}
						data-dimmed={side === actionSide &&
							selectedActionId !== undefined &&
							selectedActionId !== action.id}
						disabled={disabled || action.disabled}
						onclick={() => choose(action, actionSide)}
					>
						<span class="action-fill" aria-hidden="true"></span>
						<span class="action-label">{action.label}</span>
					</button>
				{/each}
			</div>
		{/each}
	</div>
	<div
		bind:this={surface}
		class="surface"
		style:transform={`translateX(${snapshot.context.offset}px)`}
	>
		<div class="content">{@render children()}</div>
	</div>
	<ScreenReaderText role="status">{armed?.label ?? ''}</ScreenReaderText>
</div>

<style>
	@property --dui-swipe-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-swipe-action-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-swipe-duration {
		syntax: '<time>';
		inherits: true;
		initial-value: 180ms;
	}

	.swipe-actions {
		position: relative;
		isolation: isolate;
		min-inline-size: 0;
		overflow: clip;
	}

	.swipe-actions[hidden]:not([hidden='until-found']) {
		display: none;
	}

	.tray {
		position: absolute;
		inset-block: 0;
		display: flex;
		inline-size: max-content;
		max-inline-size: calc(100% - 44px);
		visibility: hidden;
	}

	.tray[data-side='left'] {
		left: 0;
	}
	.tray[data-side='right'] {
		right: 0;
		flex-direction: row-reverse;
	}
	.tray[data-visible='true'] {
		visibility: visible;
	}

	.action {
		position: relative;
		isolation: isolate;
		display: grid;
		place-items: center;
		flex: 1 1 var(--dui-swipe-action-width, 5.5rem);
		inline-size: var(--dui-swipe-action-width, 5.5rem);
		min-inline-size: 0;
		appearance: none;
		border: 0;
		border-radius: 0;
		padding: 0;
		min-block-size: 44px;
		font: inherit;
		line-height: 1.25;
		overflow-wrap: anywhere;
		cursor: pointer;
		color: var(--dui-color-background, #fff);
		background: var(--dui-color-foreground, #000);
		transition: opacity var(--dui-swipe-duration, 180ms) ease-out;
	}

	.action-fill {
		position: absolute;
		inset: 0;
		z-index: -1;
		background: inherit;
		transform: scaleX(1);
		transform-origin: right;
		transition: transform var(--dui-swipe-duration, 180ms) ease-out;
	}

	.tray[data-side='right'] .action-fill {
		transform-origin: left;
	}

	.action[data-exiting='true'] {
		z-index: 1;
	}

	.action[data-exiting='true'] .action-fill {
		transform: scaleX(var(--swipe-action-count));
	}

	.action-label {
		/* Grow the action surface without reflowing its label. */
		box-sizing: border-box;
		inline-size: var(--swipe-label-width);
		padding: var(--dui-spacing-xs, 0.5rem);
	}

	.action[data-variant='destructive'] {
		background: var(--dui-color-error, #b91c1c);
		color: var(--dui-color-on-error, #fff);
	}

	.action[data-variant='secondary'] {
		background: var(--dui-color-background, #fff);
		color: var(--dui-color-foreground, #000);
	}

	.action:focus-visible {
		outline: 2px dashed var(--dui-color-focus, #2563eb);
		outline-offset: -4px;
	}

	.action:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.action[data-dimmed='true'] {
		opacity: 0.35;
	}

	.surface {
		position: relative;
		display: block;
		min-block-size: 44px;
		background: var(
			--dui-swipe-background-color,
			var(--dui-color-background, #fff)
		);
		touch-action: pan-y pinch-zoom;
		transition: transform var(--dui-swipe-duration, 180ms) ease-out;
	}

	.content {
		min-inline-size: 0;
	}
	.swipe-actions[data-dragging='true'] .surface {
		transition: none;
		user-select: none;
	}

	.swipe-actions[data-disabled='true'] .surface {
		touch-action: auto;
	}

	@media (prefers-reduced-motion: reduce) {
		.surface,
		.action,
		.action-fill {
			transition: none;
		}
	}

	@media (forced-colors: active) {
		.surface {
			background: Canvas;
		}
	}
</style>
