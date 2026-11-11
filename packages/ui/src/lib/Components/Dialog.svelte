<script lang="ts">
	import { onDestroy, type Snippet } from 'svelte'
	import type { HTMLDialogAttributes } from 'svelte/elements'

	type Props = Omit<HTMLDialogAttributes, 'open' | 'popover' | 'tabindex'> & {
		heading: string | Snippet
		headingLevel?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
		open?: boolean
	}

	const generatedId = $props.id()
	let {
		heading,
		headingLevel = 'h2',
		open = $bindable(false),
		id,
		'aria-labelledby': labelledBy,
		onbeforetoggle,
		onclose,
		ontoggle,
		children,
		...attributes
	}: Props = $props()
	let dialog = $state<HTMLDialogElement>()
	const dialogId = $derived(id ?? generatedId)
	const headingId = `${generatedId}-heading`
	const supportsClosedBy =
		typeof HTMLDialogElement !== 'undefined' &&
		'closedBy' in HTMLDialogElement.prototype
	function closeOnBackdrop(event: MouseEvent | TouchEvent) {
		if (
			!supportsClosedBy &&
			attributes.closedby === 'any' &&
			dialog?.open &&
			event.target === dialog
		) {
			dialog.close()
		}
	}

	$effect(() => {
		if (!dialog) return
		if (open && !dialog.open) {
			dialog.returnValue = ''
			dialog.showModal()
			open = dialog.open
		} else if (!open && dialog.open) {
			dialog.close()
		}
	})

	onDestroy(() => {
		if (dialog?.open) dialog.close()
	})
</script>

<dialog
	{...attributes}
	id={dialogId}
	aria-labelledby={labelledBy ?? headingId}
	bind:this={dialog}
	onclick={closeOnBackdrop}
	ontouchend={closeOnBackdrop}
	onbeforetoggle={(event) => {
		// Native closure restores focus before queued close/toggle events arrive.
		// Synchronize now so an immediate activation can reopen the dialog.
		if (event.newState === 'closed') open = false
		onbeforetoggle?.(event)
	}}
	onclose={(event) => {
		open = event.currentTarget.open
		onclose?.(event)
	}}
	ontoggle={(event) => {
		open = event.currentTarget.open
		ontoggle?.(event)
	}}
>
	<svelte:element this={headingLevel} id={headingId} class="heading">
		{#if typeof heading === 'function'}
			{@render heading()}
		{:else}
			{heading}
		{/if}
	</svelte:element>
	{@render children?.()}
</dialog>

<style>
	@property --dui-dialog-backdrop-color {
		syntax: '<color>';
		inherits: true;
		initial-value: #000;
	}

	@property --dui-dialog-backdrop-opacity {
		syntax: '<number> | <percentage>';
		inherits: true;
		initial-value: 0.5;
	}

	@property --dui-dialog-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-border-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-border-style {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-border-width {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-heading-font-size {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-padding {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-shadow {
		syntax: '*';
		inherits: true;
	}

	@property --dui-dialog-width {
		syntax: '*';
		inherits: true;
	}

	dialog {
		box-sizing: border-box;
		inline-size: var(--dui-dialog-width, 32rem);
		max-inline-size: calc(100vw - 2rem);
		max-block-size: calc(100dvh - 2rem);
		overflow: auto;
		padding: var(
			--dui-dialog-padding,
			var(--dui-space-md, var(--dui-spacing-lg, 1.5rem))
		);
		color: var(--dui-dialog-color, var(--dui-color-foreground, #262626));
		background-color: var(
			--dui-dialog-background-color,
			var(--dui-color-background, #fff)
		);
		border-color: var(
			--dui-dialog-border-color,
			var(--dui-color-foreground, currentColor)
		);
		border-style: var(--dui-dialog-border-style, solid);
		border-width: var(--dui-dialog-border-width, var(--dui-border-width, 2px));
		border-radius: 0;
		box-shadow: var(
			--dui-dialog-shadow,
			var(--dui-shadow, 3px 3px 0 currentColor)
		);
	}

	dialog::backdrop {
		background-color: var(--dui-dialog-backdrop-color, #000);
		opacity: var(--dui-dialog-backdrop-opacity, 0.5);
	}

	.heading {
		margin: 0 0 var(--dui-space-sm, var(--dui-spacing-md, 1rem));
		font-size: var(
			--dui-dialog-heading-font-size,
			var(--dui-font-size-xl, 1.25rem)
		);
		line-height: 1.25;
	}

	@media (forced-colors: active) {
		dialog {
			box-shadow: none;
		}
	}
</style>
