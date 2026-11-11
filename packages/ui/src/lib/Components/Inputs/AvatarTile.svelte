<script lang="ts">
	import type { Snippet } from 'svelte'
	let {
		shape = 'square',
		status,
		picker = false,
		children
	}: {
		shape?: 'square' | 'circle'
		status?: 'ready' | 'uploading' | 'error'
		picker?: boolean
		children: Snippet
	} = $props()
</script>

<div class="tile" data-shape={shape} data-status={status} data-picker={picker}>
	{@render children()}
</div>

<style>
	@property --dui-avatar-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-avatar-size {
		syntax: '*';
		inherits: true;
	}

	.tile {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--dui-field-gap, var(--dui-spacing-xxs, 0.25rem));
		box-sizing: border-box;
		width: var(--dui-avatar-size, 8rem);
		max-width: 100%;
		aspect-ratio: 1;
		border: var(--dui-border-width, 2px) dashed
			var(--dui-input-border-color, var(--dui-color-foreground, currentColor));
		background: var(
			--dui-input-background-color,
			var(--dui-color-background, transparent)
		);
		color: var(--dui-input-color, var(--dui-color-foreground, inherit));
		font-family: var(
			--dui-input-font-family,
			var(
				--dui-font-family-interactive,
				'Cascadia Code',
				ui-monospace,
				monospace
			)
		);
		font-size: var(--dui-input-font-size, var(--dui-font-size-md, 1rem));
	}

	.tile[data-shape='circle'] {
		border-radius: 50%;
	}
	.tile[data-picker='false'] {
		overflow: hidden;
		border-style: solid;
	}
	.tile[data-status='error'] {
		color: var(--dui-input-error-color, var(--dui-color-error, #b91c1c));
		border-color: currentColor;
	}
	.tile:has(:global(input:not(:disabled))):hover {
		border-color: var(
			--dui-input-border-color-focus,
			var(--dui-color-accent, currentColor)
		);
	}
	.tile:has(:global(input:focus-visible)) {
		outline: 2px dashed
			var(--dui-input-focus-color, var(--dui-color-focus, #2563eb));
		outline-offset: 4px;
	}
	.tile:has(
		:global(
			input:is([data-valid='false'], [aria-invalid='true'], :user-invalid)
		)
	) {
		border-color: var(--dui-input-error-color, var(--dui-color-error, #b91c1c));
	}
	.tile:has(:global(input:disabled)) {
		opacity: var(--dui-input-disabled-opacity, 0.5);
	}
	@media (forced-colors: active) {
		.tile:has(:global(input:focus-visible)) {
			outline-color: Highlight;
		}
	}
</style>
