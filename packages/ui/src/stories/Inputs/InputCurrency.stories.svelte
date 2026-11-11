<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputCurrency from '#lib/Components/Inputs/InputCurrency.svelte'
	import FieldFeedback from '#lib/Components/Inputs/FieldFeedback.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/InputCurrency',
		component: InputCurrency,
		tags: ['autodocs'],
		args: { label: 'Amount', currencyLabel: 'USD', name: 'amount' }
	})
</script>

<script lang="ts">
	let submitted = $state('No submission yet.')
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (event.currentTarget instanceof HTMLFormElement) {
			submitted = JSON.stringify(Array.from(new FormData(event.currentTarget)))
		}
	}
</script>

<Story name="Default" />
<Story name="Initial value" args={{ defaultValue: '12.50' }} />
<Story name="Read only" args={{ defaultValue: '12.50', readonly: true }} />
<Story name="Disabled" args={{ defaultValue: '12.50', disabled: true }} />
<Story
	name="Comma decimal"
	args={{ currencyLabel: 'EUR', defaultValue: '12,50' }}
/>
<Story name="Form submission" args={{ defaultValue: '12.50', required: true }}>
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<InputCurrency {...args} />
			<div class="actions">
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>
<Story name="With feedback">
	{#snippet template(args)}
		<div class="field-example">
			<InputCurrency
				{...args}
				aria-describedby="currency-help"
				aria-invalid="true"
			/>
			<FieldFeedback
				id="currency-help"
				instructions="Enter the amount using a decimal point."
				errorMessage="Enter a valid amount."
			/>
		</div>
	{/snippet}
</Story>

<style>
	form {
		display: grid;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}

	.actions {
		display: flex;
		gap: var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem));
	}

	.field-example {
		display: grid;
		gap: var(--dui-field-gap, var(--dui-spacing-xxs, 0.25rem));
	}

	pre {
		margin: 0;
	}
</style>
