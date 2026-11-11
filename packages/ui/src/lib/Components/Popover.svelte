<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements'

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'id' | 'popover'> & {
		id: string
	}

	let { id, children, class: className, ...attributes }: Props = $props()
</script>

<div {...attributes} {id} popover="auto" class={['popover', className]}>
	{@render children?.()}
</div>

<style>
	@property --dui-popover-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-popover-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-popover-border-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-popover-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-popover-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-popover-padding {
		syntax: '*';
		inherits: true;
	}

	@property --dui-popover-shadow {
		syntax: '*';
		inherits: true;
	}

	@property --dui-popover-width {
		syntax: '*';
		inherits: true;
	}

	.popover {
		box-sizing: border-box;
		inline-size: var(--dui-popover-width, 24rem);
		max-inline-size: calc(100dvw - 2rem);
		max-block-size: calc(100dvh - 2rem);
		overflow: auto;
		padding: var(
			--dui-popover-padding,
			var(--dui-space-sm, var(--dui-spacing-md, 1rem))
		);
		color: var(--dui-popover-color, var(--dui-color-foreground, #262626));
		background-color: var(
			--dui-popover-background-color,
			var(--dui-color-background, #fff)
		);
		border: var(--dui-popover-border-width, var(--dui-border-width, 2px)) solid
			var(--dui-popover-border-color, var(--dui-color-foreground, currentColor));
		border-radius: 0;
		box-shadow: var(
			--dui-popover-shadow,
			var(--dui-shadow, 3px 3px 0 currentColor)
		);
	}

	@supports (position-area: block-end) {
		.popover {
			position: fixed;
			position-anchor: auto;
			inset: auto;
			margin: var(--dui-popover-gap, var(--dui-spacing-xxs, 0.25rem));
			position-area: block-end;
			position-try-fallbacks:
				flip-block,
				flip-inline,
				flip-block flip-inline,
				--popover-end,
				--popover-start;
		}

		@position-try --popover-end {
			position-area: inline-end;
		}

		@position-try --popover-start {
			position-area: inline-start;
		}
	}

	@media (forced-colors: active) {
		.popover {
			box-shadow: none;
		}
	}
</style>
