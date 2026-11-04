<script lang="ts">
	import type { Snippet } from 'svelte'

	let { children }: { children: Snippet } = $props()
</script>

<div class="floating-action-space">
	{@render children()}
</div>

<style>
	.floating-action-space {
		position: sticky;
		inset-block-end: 0;
		display: flex;
		justify-content: end;
	}

	.floating-action-space > :global(:is(a, button)) {
		appearance: none;
		box-sizing: border-box;
		z-index: 1;
		display: flex;
		flex: none;
		align-items: center;
		justify-content: center;
		inline-size: var(--dui-floating-action-size, 3.5rem);
		block-size: var(--dui-floating-action-size, 3.5rem);
		padding: 0;
		border: var(--dui-border-width, 2px) solid
			var(--dui-color-foreground, #262626);
		border-radius: 50%;
		background-color: var(--dui-color-accent, #94ff47);
		color: var(--dui-color-on-accent, #262626);
		font: inherit;
		font-size: var(
			--dui-floating-action-icon-size,
			var(--dui-font-size-xxl, 1.5rem)
		);
		line-height: 1;
		text-decoration: none;
		box-shadow: var(
			--dui-shadow,
			3px 3px 0 var(--dui-color-foreground, #262626)
		);
		cursor: pointer;
	}

	.floating-action-space > :global(:is(a, button):not(:disabled):hover) {
		background-color: var(--dui-color-foreground, #262626);
		color: var(--dui-color-background, #fff);
	}

	.floating-action-space > :global(:is(a, button):focus-visible) {
		outline: 2px solid var(--dui-color-focus, currentColor);
		outline-offset: 4px;
	}

	.floating-action-space > :global(button:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
