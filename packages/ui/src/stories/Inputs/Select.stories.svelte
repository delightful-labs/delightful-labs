<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Select from '#lib/Components/Inputs/Select.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Select',
		component: Select,
		args: { label: 'Category', name: 'category', defaultValue: 'personal' }
	})
</script>

<script lang="ts">
	let submitted = $state('No submission yet.')

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitted = JSON.stringify(Array.from(new FormData(event.currentTarget)))
	}
</script>

<Story name="Form submission">
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<Select {...args}>
				<option value="">Choose a category</option>
				<optgroup label="Categories">
					<option value="personal">Personal</option>
					<option value="work">Work</option>
					<option value="unavailable" disabled>Unavailable</option>
				</optgroup>
			</Select>
			<div class="controls">
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story name="Required" args={{ required: true, defaultValue: '' }}>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<Select {...args}>
				<option value="">Choose a category</option>
				<option value="personal">Personal</option>
				<option value="work">Work</option>
			</Select>
			<Button type="submit">Submit</Button>
		</form>
	{/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true }}>
	{#snippet template(args)}
		<Select {...args}>
			<option value="personal">Personal</option>
			<option value="work">Work</option>
		</Select>
	{/snippet}
</Story>

<Story
	name="Multiple"
	args={{ multiple: true, defaultValue: ['personal'], size: 3 }}
>
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<Select {...args}>
				<option value="personal">Personal</option>
				<option value="work">Work</option>
				<option value="other">Other</option>
			</Select>
			<div class="controls">
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
			<pre aria-live="polite">{submitted}</pre>
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
