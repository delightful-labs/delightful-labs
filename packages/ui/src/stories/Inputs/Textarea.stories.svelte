<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Textarea from '#lib/Components/Inputs/Textarea.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Textarea',
		component: Textarea,
		args: {
			label: 'Notes',
			name: 'notes',
			defaultValue: 'First line\nSecond line'
		}
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
			<Textarea {...args} />
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
	args={{ required: true, defaultValue: '', minlength: 5, maxlength: 40 }}
>
	{#snippet template(args)}
		<form onsubmit={submit}>
			<Textarea {...args} />
			<Button type="submit">Submit</Button>
			<pre aria-live="polite">{submitted}</pre>
		</form>
	{/snippet}
</Story>

<Story name="Readonly" args={{ readonly: true }} />
<Story name="Disabled" args={{ disabled: true }} />

<Story name="Optional binding">
	{#snippet template(args)}
		<form onsubmit={submit} onreset={() => (submitted = 'No submission yet.')}>
			<Textarea {...args} bind:value={boundValue} />
			<div class="controls">
				<Button onclick={() => (boundValue = 'Updated by parent')}
					>Set value</Button
				>
				<Button onclick={() => (boundValue = '')}>Clear value</Button>
				<Button type="reset">Reset</Button>
			</div>
			<output aria-label="Notes value">{boundValue ?? 'undefined'}</output>
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
