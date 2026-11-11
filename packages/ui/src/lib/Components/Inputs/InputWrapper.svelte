<script lang="ts">
	import type { Snippet } from 'svelte'

	type Props = {
		title: string
		key: string
		children: Snippet
	}

	let { title, key, children }: Props = $props()
</script>

<div class="wrapper">
	<label for={key}>{title}</label>
	{@render children()}
</div>

<style>
	@property --dui-field-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-field-font-family {
		syntax: '*';
		inherits: true;
	}

	@property --dui-field-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-field-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-border-color-focus {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-border-style {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-border-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-disabled-opacity {
		syntax: '<number> | <percentage>';
		inherits: true;
		initial-value: 0.5;
	}

	@property --dui-input-error-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-focus-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-font-family {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-input-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 44px;
	}

	@property --dui-input-padding {
		syntax: '*';
		inherits: true;
	}

	.wrapper {
		display: flex;
		flex-direction: column;
		gap: var(--dui-field-gap, var(--dui-spacing-xxs, 0.25rem));
		min-width: 0;
	}

	label {
		font-family: var(
			--dui-field-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(--dui-field-font-size, var(--dui-font-size-sm, 0.875rem));
		color: var(--dui-field-color, var(--dui-color-foreground, inherit));
	}

	.wrapper :global(:is(input, select, textarea)) {
		font-family: var(
			--dui-input-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(--dui-input-font-size, inherit);
		line-height: 1.25;
		box-sizing: border-box;
		padding: var(
			--dui-input-padding,
			var(--dui-spacing-xs, 0.5rem) var(--dui-spacing-md, 1rem)
		);
		color: var(--dui-input-color, var(--dui-color-foreground, inherit));
		min-height: var(--dui-input-min-height, 44px);
		min-width: 0;
		border-color: var(
			--dui-input-border-color,
			var(--dui-color-foreground, currentColor)
		);
		border-style: var(--dui-input-border-style, solid);
		border-width: var(--dui-input-border-width, var(--dui-border-width, 2px));
		border-radius: 0;
		background-color: var(
			--dui-input-background-color,
			var(--dui-color-background, transparent)
		);
	}

	.wrapper :global(:is(input, select)[size]) {
		align-self: start;
		max-width: 100%;
	}

	.wrapper :global(:is(input, select, textarea):focus) {
		border-color: var(
			--dui-input-border-color-focus,
			var(--dui-color-accent, currentColor)
		);
	}

	.wrapper :global(:is(input, select, textarea):focus-visible) {
		outline: 2px dashed
			var(--dui-input-focus-color, var(--dui-color-focus, currentColor));
		outline-offset: 4px;
	}

	.wrapper :global(:is(input, select, textarea)[data-valid='false']),
	.wrapper :global(:is(input, select, textarea)[aria-invalid='true']),
	.wrapper :global(:is(input, select, textarea):user-invalid) {
		border-color: var(--dui-input-error-color, var(--dui-color-error, #b91c1c));
	}

	.wrapper :global(:is(input, select, textarea):disabled) {
		opacity: var(--dui-input-disabled-opacity, 0.5);
		cursor: not-allowed;
	}

	@media (forced-colors: active) {
		.wrapper :global(:is(input, select, textarea):focus-visible) {
			outline-color: Highlight;
		}
	}
</style>
