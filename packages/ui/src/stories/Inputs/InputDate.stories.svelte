<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputDate from '#lib/Components/Inputs/InputDate.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Date',
		component: InputDate,
		args: { label: 'Date', name: 'date', defaultValue: '2026-10-13' }
	})
</script>

<script lang="ts">
	let submitted = $state('No submission yet.')
	let boundValue = $state<string | undefined>()

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitted = JSON.stringify(Array.from(new FormData(event.currentTarget)))
	}
</script>

<Story name="Form submission">
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<InputDate {...args} />
			<div class="controls">
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story
	name="Constraints"
	args={{
		required: true,
		defaultValue: '',
		min: '2026-10-01',
		max: '2026-10-31',
		step: 2
	}}
>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<InputDate {...args} />
			<Button type="submit">Submit</Button>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story name="Readonly" args={{ readonly: true }} />
<Story name="Disabled" args={{ disabled: true }} />

<Story name="Optional binding">
	{#snippet template(args)}
		<form onsubmit={submit}>
			<InputDate {...args} bind:value={boundValue} />
			<div class="controls">
				<Button onclick={() => (boundValue = '2026-10-21')}>Set date</Button>
				<Button onclick={() => (boundValue = '')}>Clear date</Button>
				<Button type="reset">Reset</Button>
			</div>
			<output aria-label="Date value">{boundValue ?? 'undefined'}</output>
		</form>
	{/snippet}
</Story>

<style>
	form {
		display: grid;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
		max-inline-size: 32rem;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}
</style>
