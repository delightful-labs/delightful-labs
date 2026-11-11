<script lang="ts">
	import { tick, type Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'
	import Button from './Button.svelte'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	import ScreenReaderText from './ScreenReaderText.svelte'

	type Props = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
		heading: string | Snippet
		headingLevel?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
		headingHidden?: boolean
		closeLabel: string
		/** Receives dismissal and the translated accessible label. */
		closeControl?: Snippet<[() => void, string]>
		showCloseButton?: boolean
		side?: 'left' | 'right'
		open?: boolean
		children?: Snippet
	}

	const generatedId = $props.id()
	const inlineHeadingId = `${generatedId}-heading`
	let inlinePanel = $state<HTMLElement>()
	let inlineInvoker: HTMLElement | undefined
	let wasOpen = false

	let {
		heading,
		headingLevel = 'h2',
		headingHidden = false,
		showCloseButton = true,
		closeLabel,
		closeControl,
		side = 'left',
		open = $bindable(false),
		children,
		class: className,
		...attributes
	}: Props = $props()

	function closeDrawer() {
		open = false
	}

	$effect.pre(() => {
		if (open && !wasOpen) {
			const active = document.activeElement
			inlineInvoker = active instanceof HTMLElement ? active : undefined
		}
		if (!open && wasOpen && inlinePanel?.contains(document.activeElement)) {
			const trigger = inlineInvoker
			if (trigger?.isConnected) {
				void tick().then(() => {
					if (!open && trigger.isConnected) trigger.focus()
				})
			}
		}
		wasOpen = open
	})

	$effect(() => {
		if (!open || !inlinePanel) return
		const panel = inlinePanel
		function dismiss(event: KeyboardEvent) {
			if (
				event.key === 'Escape' &&
				!event.defaultPrevented &&
				panel.contains(document.activeElement)
			) {
				open = false
			}
		}
		document.addEventListener('keydown', dismiss)
		return () => document.removeEventListener('keydown', dismiss)
	})
</script>

<aside
	{...attributes}
	bind:this={inlinePanel}
	class={['inline-drawer', className]}
	inert={!open}
	aria-labelledby={inlineHeadingId}
	data-side={side}
	data-open={open}
	data-close-button={showCloseButton}
	aria-hidden={!open}
>
	<div class="inline-panel">
		<svelte:element
			this={headingLevel}
			id={inlineHeadingId}
			class={['inline-heading', { 'heading-hidden': headingHidden }]}
		>
			{#if typeof heading === 'string'}{heading}{:else}{@render heading()}{/if}
		</svelte:element>
		{#if showCloseButton}
			<div class="drawer-close" class:default-close={!closeControl}>
				{#if closeControl}
					{@render closeControl(closeDrawer, closeLabel)}
				{:else}
					<Button type="button" appearance="flat" onclick={closeDrawer}>
						<CloseIcon
							aria-hidden="true"
							focusable="false"
							width="1em"
							height="1em"
						/><ScreenReaderText>{closeLabel}</ScreenReaderText>
					</Button>
				{/if}
			</div>
		{/if}
		<div class="drawer-body" data-close-button={showCloseButton}>
			{@render children?.()}
		</div>
	</div>
</aside>

<style>
	@property --dui-drawer-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-duration {
		syntax: '<time>';
		inherits: true;
		initial-value: 225ms;
	}

	@property --dui-drawer-enter-easing {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-exit-easing {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-heading-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-height {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-padding {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-panel-border-inline-end {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-top {
		syntax: '*';
		inherits: true;
	}

	@property --dui-drawer-width {
		syntax: '*';
		inherits: true;
	}

	.inline-drawer {
		--_dui-drawer-width: var(--dui-drawer-width, 24rem);
		--_dui-drawer-transition-easing: var(
			--dui-drawer-exit-easing,
			cubic-bezier(0.4, 0, 1, 1)
		);
		position: sticky;
		inset-block-start: var(--dui-drawer-top, 0);
		block-size: var(--dui-drawer-height, 100dvh);
		flex: 0 0 min(var(--_dui-drawer-width), 100%);
		inline-size: min(var(--_dui-drawer-width), 100%);
		max-inline-size: 100%;
		min-inline-size: 0;
		overflow: clip;
		transition: flex-basis var(--dui-drawer-duration, 225ms)
			var(--_dui-drawer-transition-easing);
	}

	.inline-drawer[data-open='false'] {
		--_dui-drawer-width: 0px;
	}

	.inline-panel {
		--_dui-drawer-header-columns: minmax(0, 1fr) 2.75rem;

		box-sizing: border-box;
		block-size: 100%;
		min-block-size: 0;
		overflow: hidden;
		display: grid;
		grid-template-columns: var(--_dui-drawer-header-columns);
		grid-template-rows: auto minmax(0, 1fr);
		align-content: start;
		gap: var(
			--dui-drawer-gap,
			var(--dui-space-sm, var(--dui-spacing-md, 1rem))
		);
		padding: var(
			--dui-drawer-padding,
			var(--dui-space-md, var(--dui-spacing-lg, 1.5rem))
		);
		color: var(--dui-drawer-color, var(--dui-color-foreground, inherit));
		background-color: var(
			--dui-drawer-background-color,
			var(--dui-color-background, transparent)
		);
		border: 0;
		border-inline-end: var(--dui-drawer-panel-border-inline-end, 0);
		transform: translateX(-100%);
		transition: transform var(--dui-drawer-duration, 225ms)
			var(--_dui-drawer-transition-easing);
	}

	.inline-drawer[data-side='right'] .inline-panel {
		transform: translateX(100%);
	}

	.inline-drawer[data-open='true'] {
		--_dui-drawer-transition-easing: var(
			--dui-drawer-enter-easing,
			cubic-bezier(0, 0, 0.2, 1)
		);
	}

	.inline-drawer[data-open='true'] .inline-panel {
		transform: translateX(0);
	}

	.inline-drawer[data-close-button='false'] .inline-panel {
		--_dui-drawer-header-columns: minmax(0, 1fr);
	}

	.inline-drawer:not([data-open='true']) {
		pointer-events: none;
	}

	.inline-heading {
		grid-column: 1;
		grid-row: 1;
		align-self: center;
		margin: 0;
		font-size: var(
			--dui-drawer-heading-font-size,
			var(--dui-font-size-xl, 1.25rem)
		);
		line-height: 1.25;
		overflow-wrap: anywhere;
	}

	.heading-hidden {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.default-close :global(button) {
		--dui-button-padding: 0;
		--dui-button-border-width: 0;
		inline-size: 2.75rem;
		block-size: 2.75rem;
		font-size: var(--dui-font-size-xxl, 1.5rem);
	}

	.drawer-close {
		grid-column: 2;
		grid-row: 1;
	}

	.drawer-body[data-close-button='false'] {
		grid-row: 1 / -1;
	}

	.drawer-body {
		grid-column: 1 / -1;
		grid-row: 2;
		min-inline-size: 0;
		min-block-size: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}

	@media (prefers-reduced-motion: reduce) {
		.inline-panel,
		.inline-drawer {
			transition: none;
		}
	}
</style>
