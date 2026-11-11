<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Checkbox from '#lib/Components/Inputs/Checkbox.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Checkbox',
		component: Checkbox,
		args: { label: 'Receive updates', name: 'updates', value: 'yes' }
	})
</script>

<script lang="ts">
	let submitted = $state('No submission yet.')
	let boundChecked = $state<boolean | undefined>()

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitted = JSON.stringify(Array.from(new FormData(event.currentTarget)))
	}
</script>

<Story name="Form submission" args={{ defaultChecked: true }}>
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<Checkbox {...args} />
			<div class="controls">
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story
	name="Required"
	args={{ label: 'Accept the terms', name: 'accepted', required: true }}
>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<Checkbox {...args} />
			<Button type="submit">Submit</Button>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, defaultChecked: true }} />
<Story
	name="Long label"
	args={{
		label:
			'Receive updates about upcoming changes and announcements for this project'
	}}
/>

<Story name="Optional binding" args={{ defaultChecked: true }}>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<Checkbox {...args} bind:checked={boundChecked} />
			<div class="controls">
				<Button onclick={() => (boundChecked = false)}
					>Uncheck from parent</Button
				>
				<Button onclick={() => (boundChecked = true)}>Check from parent</Button>
				<Button type="reset">Reset</Button>
			</div>
			<output aria-label="Checked state">{String(boundChecked)}</output>
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
