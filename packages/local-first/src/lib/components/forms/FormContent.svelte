<script lang="ts" generics="View extends FormPresentation">
	import type { Snippet } from 'svelte'
	import type { FormPresentation } from '../../contracts/scoped-form.js'

	let {
		view,
		onsubmit,
		onreset,
		oninput,
		fields,
		supplemental,
		controls,
		controlsFill = false,
		feedback
	}: {
		view: View
		onsubmit: (event: SubmitEvent) => void
		oninput?: ((event: Event) => void) | undefined
		onreset: (event: Event) => void
		fields: Snippet<[View]>
		supplemental?: Snippet<[View]>
		controls?: Snippet<[View]> | undefined
		controlsFill?: boolean
		feedback?: Snippet<[View]> | undefined
	} = $props()
</script>

<form {onsubmit} {onreset} {oninput} aria-busy={view.activity.kind !== 'idle'}>
	{#key view.draftRevision}
		<fieldset class="form-fields" disabled={!view.fieldsEditable}>
			{@render fields(view)}
		</fieldset>
	{/key}
	{#if supplemental}{@render supplemental(view)}{/if}
	{#if controls}
		<div class="form-controls" class:fill={controlsFill}>{@render controls(view)}</div>
	{/if}
	<!-- Future field feedback: docs/delightful-ui-integration.md#field-feedback -->
	{#if feedback}
		<div class="form-feedback">{@render feedback(view)}</div>
	{/if}
</form>

<style>
	form {
		display: grid;
		gap: var(--dui-spacing-md);
	}

	.form-fields,
	.form-feedback {
		display: grid;
		gap: var(--dui-spacing-xs);
		min-width: 0;
	}

	.form-fields {
		border: 0;
		padding: 0;
		margin: 0;
	}

	.form-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-spacing-xs);
	}

	.form-controls.fill :global {
		> button {
			flex: 1 1 calc((100% - var(--dui-spacing-xs)) / 2);
			min-inline-size: 0;
		}
	}

	.form-fields:empty,
	.form-controls:empty,
	.form-feedback:empty {
		display: none;
	}
</style>
