<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import RadioGroup from '#lib/Components/Inputs/RadioGroup.svelte'
	import RadioItem from '#lib/Components/Inputs/RadioItem.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/RadioGroup',
		component: RadioGroup,
		args: { label: 'View', name: 'view' }
	})
</script>

<script lang="ts">
	let selected = $state<string>()
	let plan = $state<string>('personal')
	let showTeam = $state(false)
	let itemChanged = $state('No item changes yet.')
	let submitted = $state('No submission yet.')

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitted = JSON.stringify(Array.from(new FormData(event.currentTarget)))
	}
</script>

{#snippet choices()}
	<RadioItem value="day">Day</RadioItem>
	<RadioItem value="week">Week</RadioItem>
	<RadioItem value="month">Month</RadioItem>
{/snippet}

<Story name="Default" args={{ defaultValue: 'week' }}>
	{#snippet template(args)}
		<RadioGroup {...args}>{@render choices()}</RadioGroup>
	{/snippet}
</Story>
<Story name="No selection">
	{#snippet template(args)}
		<RadioGroup {...args}>{@render choices()}</RadioGroup>
	{/snippet}
</Story>
<Story name="Disabled" args={{ disabled: true, defaultValue: 'week' }}>
	{#snippet template(args)}
		<RadioGroup {...args}>{@render choices()}</RadioGroup>
	{/snippet}
</Story>
<Story name="Disabled option" args={{ defaultValue: 'day' }}>
	{#snippet template(args)}
		<RadioGroup {...args}>
			<RadioItem value="day">Day</RadioItem>
			<RadioItem value="week" disabled>Week</RadioItem>
			<RadioItem value="month">Month</RadioItem>
		</RadioGroup>
	{/snippet}
</Story>

<Story name="Form submission" args={{ defaultValue: 'week' }}>
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<RadioGroup {...args}>{@render choices()}</RadioGroup>
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
			<RadioGroup {...args}>{@render choices()}</RadioGroup>
			<Button type="submit">Submit</Button>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story name="Optional binding" args={{ defaultValue: 'week' }}>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<RadioGroup {...args} bind:value={selected}
				>{@render choices()}</RadioGroup
			>
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
			>
				{@render choices()}
			</RadioGroup>
			<RadioGroup
				{...args}
				name={undefined}
				label="Report view"
				defaultValue="month"
			>
				{@render choices()}
			</RadioGroup>
		</div>
	{/snippet}
</Story>

<Story
	name="Long labels"
	args={{ label: 'Delivery method', defaultValue: 'standard' }}
>
	{#snippet template(args)}
		<RadioGroup {...args}>
			<RadioItem value="standard"
				>Standard delivery in five business days</RadioItem
			>
			<RadioItem value="express"
				>Express delivery in two business days</RadioItem
			>
			<RadioItem value="pickup"
				>Collect from your nearest pickup location</RadioItem
			>
		</RadioGroup>
	{/snippet}
</Story>

<Story name="Custom composition" args={{ label: 'Plan', name: 'plan' }}>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<RadioGroup {...args} bind:value={plan}>
				<div class="custom-layout">
					<RadioItem value="personal" aria-describedby="personal-help">
						<strong>Personal</strong>
						<span>For everyday projects</span>
					</RadioItem>
					<RadioItem
						value="business"
						onchange={(event) => (itemChanged = event.currentTarget.value)}
					>
						<strong>Business</strong>
						<span>For larger projects</span>
					</RadioItem>
					{#if showTeam}
						<RadioItem value="team">
							<strong>Team</strong>
							<span>For shared projects</span>
						</RadioItem>
					{/if}
				</div>
			</RadioGroup>
			<p id="personal-help">Includes one workspace.</p>
			<Button onclick={() => (showTeam = !showTeam)}>Toggle team option</Button>
			<Button type="submit">Submit</Button>
			<output aria-label="Selected plan">{plan}</output>
			<output aria-label="Changed item">{itemChanged}</output>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

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

	.custom-layout {
		--dui-radio-border-overlap: 0px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
		gap: var(--dui-spacing-md, 1rem);
		inline-size: 100%;
	}

	.custom-layout strong {
		margin-inline-end: 0.5em;
	}
</style>
