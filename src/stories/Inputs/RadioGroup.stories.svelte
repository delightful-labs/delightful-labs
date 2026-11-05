<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import RadioGroup from '#lib/Components/Inputs/RadioGroup.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/RadioGroup',
		component: RadioGroup,
		args: {
			label: 'View',
			name: 'view',
			options: [
				{ label: 'Day', value: 'day' },
				{ label: 'Week', value: 'week' },
				{ label: 'Month', value: 'month' }
			]
		}
	})
</script>

<script lang="ts">
	let selected = $state<string>()
	let submitted = $state('No submission yet.')

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitted = JSON.stringify(Array.from(new FormData(event.currentTarget)))
	}
</script>

<Story name="Default" args={{ defaultValue: 'week' }} />
<Story name="No selection" />
<Story name="Disabled" args={{ disabled: true, defaultValue: 'week' }} />
<Story
	name="Disabled option"
	args={{
		defaultValue: 'day',
		options: [
			{ label: 'Day', value: 'day' },
			{ label: 'Week', value: 'week', disabled: true },
			{ label: 'Month', value: 'month' }
		]
	}}
/>

<Story name="Form submission" args={{ defaultValue: 'week' }}>
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<RadioGroup {...args} />
			<div class="controls">
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story name="Required" args={{ required: true }}>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<RadioGroup {...args} />
			<Button type="submit">Submit</Button>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story name="Optional binding" args={{ defaultValue: 'week' }}>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<RadioGroup {...args} bind:value={selected} />
			<div class="controls">
				<Button onclick={() => (selected = 'month')}
					>Select month from parent</Button
				>
				<Button onclick={() => (selected = undefined)}>Clear selection</Button>
				<Button type="reset">Reset</Button>
			</div>
			<output aria-label="Selected view">{selected ?? 'None'}</output>
		</form>
	{/snippet}
</Story>

<Story name="Independent groups">
	{#snippet template(args)}
		<div class="groups">
			<RadioGroup
				{...args}
				name={undefined}
				label="Calendar view"
				defaultValue="day"
			/>
			<RadioGroup
				{...args}
				name={undefined}
				label="Report view"
				defaultValue="month"
			/>
		</div>
	{/snippet}
</Story>

<Story
	name="Long labels"
	args={{
		label: 'Delivery method',
		defaultValue: 'standard',
		options: [
			{ label: 'Standard delivery in five business days', value: 'standard' },
			{ label: 'Express delivery in two business days', value: 'express' },
			{ label: 'Collect from your nearest pickup location', value: 'pickup' }
		]
	}}
/>

<style>
	form,
	.groups {
		display: grid;
		gap: var(--dui-spacing-md, 1rem);
		max-inline-size: 36rem;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-spacing-md, 1rem);
	}
</style>
