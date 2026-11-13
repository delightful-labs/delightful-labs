<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements'

	type Props = HTMLButtonAttributes & {
		text?: string
		variant?: 'primary' | 'secondary' | 'destructive'
		appearance?: 'raised' | 'flat'
	}

	let {
		text = $bindable(''),
		variant = 'secondary',
		appearance = 'raised',
		type = $bindable('button'),
		disabled = $bindable(undefined),
		popovertarget = $bindable(undefined),
		class: className,
		onclick,
		children,
		...attributes
	}: Props = $props()

	let element: HTMLButtonElement | undefined

	export function focus(options?: FocusOptions) {
		element?.focus(options)
	}

	let ariaDisabled = $derived(
		attributes['aria-disabled'] === true ||
			attributes['aria-disabled'] === 'true'
	)
</script>

<button
	bind:this={element}
	{...attributes}
	{type}
	{disabled}
	{popovertarget}
	class={[
		'button',
		className,
		{
			flat: appearance === 'flat',
			primary: variant === 'primary',
			destructive: variant === 'destructive'
		}
	]}
	onclick={(event) => {
		if (disabled || ariaDisabled) {
			event.preventDefault()
			event.stopImmediatePropagation()
			return
		}
		onclick?.(event)
	}}
>
	{#if children}
		{@render children()}
	{:else}
		{text}
	{/if}
</button>

<style>
	@property --dui-button-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-background-color-active {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-background-color-destructive {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-background-color-destructive-hover {
		syntax: '<color>';
		inherits: true;
		initial-value: #991b1b;
	}

	@property --dui-button-background-color-hover {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-background-color-primary {
		syntax: '<color>';
		inherits: true;
		initial-value: #000;
	}

	@property --dui-button-background-color-primary-hover {
		syntax: '<color>';
		inherits: true;
		initial-value: #94ff47;
	}

	@property --dui-button-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-border-color-destructive {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-border-color-destructive-hover {
		syntax: '<color>';
		inherits: true;
		initial-value: #991b1b;
	}

	@property --dui-button-border-color-hover {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-border-color-primary-hover {
		syntax: '<color>';
		inherits: true;
		initial-value: #94ff47;
	}

	@property --dui-button-border-style {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-border-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-box-shadow {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-color-active {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-color-destructive {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-color-destructive-hover {
		syntax: '<color>';
		inherits: true;
		initial-value: #fff;
	}

	@property --dui-button-color-hover {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-color-primary {
		syntax: '<color>';
		inherits: true;
		initial-value: #fff;
	}

	@property --dui-button-color-primary-hover {
		syntax: '<color>';
		inherits: true;
		initial-value: #000;
	}

	@property --dui-button-disabled-opacity {
		syntax: '<number> | <percentage>';
		inherits: true;
		initial-value: 0.5;
	}

	@property --dui-button-focus-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-font-family {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 44px;
	}

	@property --dui-button-padding {
		syntax: '*';
		inherits: true;
	}

	@property --dui-button-pressed-offset {
		syntax: '*';
		inherits: true;
	}

	.button {
		--_dui-button-color: var(
			--dui-button-color,
			var(--dui-color-foreground, #000)
		);
		--_dui-button-background: var(
			--dui-button-background-color,
			var(--dui-color-background, #fff)
		);
		--_dui-button-border: var(
			--dui-button-border-color,
			var(--dui-color-foreground, #000)
		);
		--_dui-button-hover-color: var(
			--dui-button-color-hover,
			var(--dui-color-background, #fff)
		);
		--_dui-button-hover-background: var(
			--dui-button-background-color-hover,
			var(--dui-color-foreground, #000)
		);
		--_dui-button-hover-border: var(
			--dui-button-border-color-hover,
			var(--dui-color-foreground, #000)
		);
		-webkit-appearance: none;
		appearance: none;
		box-sizing: border-box;
		font-family: var(
			--dui-button-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(--dui-button-font-size, inherit);
		line-height: 1.25;
		padding: var(--dui-button-padding, var(--dui-spacing-xs, 0.5rem));
		min-height: var(--dui-button-min-height, 44px);
		color: var(--_dui-button-color);
		background-color: var(--_dui-button-background);
		border-color: var(--_dui-button-border);
		border-style: var(--dui-button-border-style, solid);
		border-width: var(--dui-button-border-width, var(--dui-border-width, 2px));
		border-radius: 0;
		box-shadow: var(
			--dui-button-box-shadow,
			var(--dui-shadow, 3px 3px 0 var(--dui-color-foreground, #000))
		);
		cursor: pointer;
		transition:
			background-color 0.15s,
			color 0.15s,
			transform 0.1s,
			box-shadow 0.1s;
	}

	.button:hover:not(:disabled, [aria-disabled='true']) {
		color: var(--_dui-button-hover-color);
		background-color: var(--_dui-button-hover-background);
		border-color: var(--_dui-button-hover-border);
	}

	.button:active:not(:disabled, [aria-disabled='true']) {
		box-shadow: none;
		transform: translate(
			var(--dui-button-pressed-offset, var(--dui-pressed-offset, 3px)),
			var(--dui-button-pressed-offset, var(--dui-pressed-offset, 3px))
		);
	}

	.flat {
		box-shadow: var(--dui-button-box-shadow, none);
	}

	.primary {
		--_dui-button-color: var(--dui-button-color-primary, #fff);
		--_dui-button-background: var(--dui-button-background-color-primary, #000);
		--_dui-button-hover-color: var(--dui-button-color-primary-hover, #000);
		--_dui-button-hover-background: var(
			--dui-button-background-color-primary-hover,
			#94ff47
		);
		--_dui-button-hover-border: var(
			--dui-button-border-color-primary-hover,
			#94ff47
		);
		border: none;
	}

	.destructive {
		--_dui-button-color: var(
			--dui-button-color-destructive,
			var(--dui-color-on-error, #fff)
		);
		--_dui-button-background: var(
			--dui-button-background-color-destructive,
			var(--dui-color-error, #b91c1c)
		);
		--_dui-button-border: var(
			--dui-button-border-color-destructive,
			var(--dui-color-error, #b91c1c)
		);
		--_dui-button-hover-color: var(--dui-button-color-destructive-hover, #fff);
		--_dui-button-hover-background: var(
			--dui-button-background-color-destructive-hover,
			#991b1b
		);
		--_dui-button-hover-border: var(
			--dui-button-border-color-destructive-hover,
			#991b1b
		);
	}

	.flat:active:not(:disabled, [aria-disabled='true']) {
		transform: none;
		color: var(--dui-button-color-active, var(--dui-color-background, #fff));
		background-color: var(
			--dui-button-background-color-active,
			var(--dui-color-foreground, #000)
		);
	}

	.button:focus-visible {
		outline: 2px dashed
			var(--dui-button-focus-color, var(--dui-color-focus, #2563eb));
		outline-offset: 4px;
	}

	.button:is(:disabled, [aria-disabled='true']) {
		opacity: var(--dui-button-disabled-opacity, 0.5);
		cursor: not-allowed;
	}

	@media (prefers-reduced-motion: reduce) {
		.button {
			transition: none;
		}

		.button:active:not(:disabled, [aria-disabled='true']) {
			transform: none;
		}
	}

	@media (forced-colors: active) {
		.button {
			box-shadow: none;
		}

		.button:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
