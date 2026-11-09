<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements'

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'id'> & {
		id: string
		instructions?: string
		errorMessage?: string
	}

	let {
		id,
		instructions,
		errorMessage,
		class: className,
		...attributes
	}: Props = $props()
</script>

<div {...attributes} {id} class={['field-feedback', className]}>
	{#if instructions}
		<span>{instructions}</span>
	{/if}
	{#if errorMessage}
		<span class="error">{errorMessage}</span>
	{/if}
</div>

<style>
	@property --dui-field-feedback-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-field-feedback-error-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-field-feedback-gap {
		syntax: '*';
		inherits: true;
	}

	.field-feedback {
		display: grid;
		gap: var(
			--dui-field-feedback-gap,
			var(--dui-field-gap, var(--dui-spacing-xxs, 0.25rem))
		);
		min-inline-size: 0;
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
		color: var(
			--dui-field-feedback-color,
			var(--dui-color-foreground, inherit)
		);
		overflow-wrap: anywhere;
	}

	.field-feedback:empty,
	.field-feedback[hidden]:not([hidden='until-found']) {
		display: none;
	}

	.error {
		color: var(
			--dui-field-feedback-error-color,
			var(--dui-color-error, #b91c1c)
		);
	}
</style>
