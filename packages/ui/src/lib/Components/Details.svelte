<script lang="ts">
	import type { Snippet } from 'svelte'
	import ChevronRight from 'tdesign-icons-svg/src/chevron-right.svg?component'
	import ChevronDown from 'tdesign-icons-svg/src/chevron-down.svg?component'
	import type { HTMLDetailsAttributes } from 'svelte/elements'

	type Props = Omit<HTMLDetailsAttributes, 'open'> & {
		summary: string | Snippet
		/** Decorative replacement for the disclosure icon; receives the expanded state. */
		caret?: Snippet<[boolean]>
		/** Replace the default padded content; absolute positioning remains library-owned. */
		content?: Snippet
		caretPosition?: 'left' | 'right'
		open?: boolean
		position?: 'inline' | 'absolute'
		align?: 'start' | 'end'
	}

	let {
		summary,
		caret,
		content,
		caretPosition = 'left',
		open = $bindable(false),
		position = 'inline',
		align = 'start',
		onkeydown,
		children,
		...attributes
	}: Props = $props()
	let disclosure = $state<HTMLDetailsElement>()
	let summaryElement = $state<HTMLElement>()

	$effect(() => {
		if (position !== 'absolute' || !open || !disclosure) return

		const element = disclosure
		const controller = new AbortController()
		document.addEventListener(
			'pointerdown',
			(event) => {
				if (!event.composedPath().includes(element)) open = false
			},
			{ capture: true, signal: controller.signal }
		)
		return () => controller.abort()
	})
</script>

<details
	{...attributes}
	data-position={position}
	data-align={align}
	bind:this={disclosure}
	bind:open
	onkeydown={(event) => {
		onkeydown?.(event)
		if (
			position === 'absolute' &&
			open &&
			event.key === 'Escape' &&
			!event.defaultPrevented
		) {
			event.preventDefault()
			open = false
			summaryElement?.focus()
		}
	}}
>
	<summary bind:this={summaryElement} data-caret-position={caretPosition}>
		<span class="details-caret" aria-hidden="true">
			{#if caret}
				{@render caret(open)}
			{:else}
				{@const CaretIcon = open ? ChevronDown : ChevronRight}
				<CaretIcon
					viewBox="0 0 24 24"
					width="1em"
					height="1em"
					focusable="false"
				/>
			{/if}
		</span>
		<span class="summary-text">
			{#if typeof summary === 'string'}
				{summary}
			{:else}
				{@render summary()}
			{/if}
		</span>
	</summary>
	{#snippet body()}
		{#if content}
			{@render content()}
		{:else}
			<div class="details-content" class:divided={position === 'inline'}>
				{@render children?.()}
			</div>
		{/if}
	{/snippet}
	{#if position === 'absolute'}
		<div class="details-panel" data-align={align}>
			{@render body()}
		</div>
	{:else}
		{@render body()}
	{/if}
</details>

<style>
	@property --dui-details-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-border-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-caret-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-content-border-width {
		syntax: '<length> | thin | medium | thick';
		inherits: true;
		initial-value: 1px;
	}

	@property --dui-details-content-padding {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-focus-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-panel-max-height {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-panel-max-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-panel-offset {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-panel-shadow {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-panel-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-panel-z-index {
		syntax: '<integer> | auto';
		inherits: true;
		initial-value: 10;
	}

	@property --dui-details-summary-background-color-hover {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-summary-color-hover {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-summary-font-family {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-summary-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-details-summary-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 44px;
	}

	@property --dui-details-summary-padding {
		syntax: '*';
		inherits: true;
	}

	details {
		box-sizing: border-box;
		min-width: 0;
		color: var(--dui-details-color, var(--dui-color-foreground, inherit));
		background-color: var(
			--dui-details-background-color,
			var(--dui-color-background, transparent)
		);
		border-color: var(
			--dui-details-border-color,
			var(--dui-color-foreground, currentColor)
		);
		border-style: solid;
		border-width: var(--dui-details-border-width, var(--dui-border-width, 2px));
		border-radius: 0;
	}

	summary {
		box-sizing: border-box;
		min-height: var(--dui-details-summary-min-height, 44px);
		padding: var(
			--dui-details-summary-padding,
			var(--dui-spacing-xs, 0.5rem) var(--dui-spacing-md, 1rem)
		);
		font-family: var(
			--dui-details-summary-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(--dui-details-summary-font-size, inherit);
		display: flex;
		align-items: center;
		gap: var(--dui-details-caret-gap, var(--dui-spacing-xs, 0.5rem));
		list-style: none;
		-webkit-user-select: none;
		user-select: none;
		cursor: pointer;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.details-caret {
		display: inline-flex;
		flex: 0 0 auto;
	}

	.summary-text {
		min-width: 0;
		flex: 1;
	}

	summary[data-caret-position='right'] .details-caret {
		order: 1;
	}

	summary:hover {
		color: var(
			--dui-details-summary-color-hover,
			var(--dui-color-on-accent, #262626)
		);
		background-color: var(
			--dui-details-summary-background-color-hover,
			var(--dui-color-accent, #94ff47)
		);
	}

	summary:focus-visible {
		outline: 2px solid
			var(--dui-details-focus-color, var(--dui-color-focus, currentColor));
		outline-offset: 4px;
	}

	.details-content {
		padding: var(
			--dui-details-content-padding,
			var(--dui-space-sm, var(--dui-spacing-md, 1rem))
		);
	}

	.divided {
		border-top: var(--dui-details-content-border-width, 1px) solid;
		border-color: var(
			--dui-details-border-color,
			var(--dui-color-foreground, currentColor)
		);
	}

	details[data-position='absolute'] {
		position: relative;
		display: inline-block;
		max-inline-size: 100%;
		vertical-align: top;
	}

	.details-panel {
		position: absolute;
		inset-block-start: calc(
			100% + var(--dui-details-panel-offset, var(--dui-spacing-xxs, 0.25rem))
		);
		inset-inline-start: 0;
		z-index: var(--dui-details-panel-z-index, 10);
		box-sizing: border-box;
		inline-size: var(--dui-details-panel-width, max-content);
		max-inline-size: var(
			--dui-details-panel-max-width,
			min(24rem, calc(100vw - 2rem))
		);
		max-block-size: var(--dui-details-panel-max-height, 70vh);
		overflow: auto;
		background-color: var(
			--dui-details-background-color,
			var(--dui-color-background, #fff)
		);
		border: var(--dui-details-border-width, var(--dui-border-width, 2px)) solid;
		border-color: var(
			--dui-details-border-color,
			var(--dui-color-foreground, currentColor)
		);
		box-shadow: var(
			--dui-details-panel-shadow,
			var(--dui-shadow, 3px 3px 0 currentColor)
		);
	}

	.details-panel[data-align='end'] {
		inset-inline-start: auto;
		inset-inline-end: 0;
	}

	/* Delay native content hiding until the closing transition finishes. */
	details {
		--_dui-details-easing: var(
			--dui-details-exit-easing,
			cubic-bezier(0.4, 0, 1, 1)
		);
	}

	details[open] {
		--_dui-details-easing: var(
			--dui-details-enter-easing,
			cubic-bezier(0, 0, 0.2, 1)
		);
	}

	details::details-content {
		transition: content-visibility var(--dui-details-duration, 225ms)
			allow-discrete;
	}

	@supports (interpolate-size: allow-keywords) {
		details[data-position='inline']::details-content {
			interpolate-size: allow-keywords;
			block-size: 0;
			overflow: clip;
			transition:
				block-size var(--dui-details-duration, 225ms) var(--_dui-details-easing),
				content-visibility var(--dui-details-duration, 225ms) allow-discrete;
		}

		details[data-position='inline'][open]::details-content {
			block-size: auto;
		}
	}

	.details-panel {
		transform: translateY(-0.25rem);
		transition: transform var(--dui-details-duration, 225ms)
			var(--_dui-details-easing);
	}

	details[open] .details-panel {
		transform: translateY(0);
	}

	@media (prefers-reduced-motion: reduce) {
		details::details-content,
		details[data-position='inline']::details-content,
		.details-panel {
			transition: none;
		}
	}

	@media (forced-colors: active) {
		.details-panel {
			box-shadow: none;
		}

		summary:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
