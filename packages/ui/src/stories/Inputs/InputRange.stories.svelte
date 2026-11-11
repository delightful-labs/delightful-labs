<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputRange from '#lib/Components/Inputs/InputRange.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Range',
		component: InputRange,
		tags: ['autodocs'],
		args: {
			label: 'Contrast',
			name: 'contrast',
			min: 0,
			max: 200,
			step: 1,
			defaultValue: 100
		}
	})
</script>

<script lang="ts">
	import Button from '#lib/Components/Button.svelte'
	import Popover from '#lib/Components/Popover.svelte'
	let contrast = $state(100)
	let formValue = $state(100)
	let submission = $state('No submission yet.')
	const contrastPopoverId = $props.id()
</script>

<Story name="Default" />
<Story name="Disabled" args={{ disabled: true }} />
<Story
	name="Fractional steps"
	args={{ min: 0, max: 2, step: 0.05, defaultValue: 1 }}
/>
<Story name="Contrast popover">
	{#snippet template(args)}
		<Button popovertarget={contrastPopoverId}>Adjust contrast</Button>
		<Popover id={contrastPopoverId} aria-label="Adjust contrast">
			<form onsubmit={(event) => event.preventDefault()}>
				<InputRange
					{...args}
					id={`${contrastPopoverId}-range`}
					bind:value={contrast}
				/>
				<output for={`${contrastPopoverId}-range`}>{contrast}%</output>
				<Button type="reset">Reset</Button>
			</form>
		</Popover>
	{/snippet}
</Story>

<Story name="Form submission">
	{#snippet template(args)}
		<form
			onsubmit={(event) => {
				event.preventDefault()
				submission = JSON.stringify([...new FormData(event.currentTarget)])
			}}
		>
			<InputRange {...args} bind:value={formValue} />
			<output aria-label="Bound value">{typeof formValue}: {formValue}</output>
			<button type="button" onclick={() => (formValue = 150)}
				>Set contrast</button
			>
			<button type="submit">Submit</button>
			<button type="reset">Reset</button>
			<pre aria-live="polite">{submission}</pre>
		</form>
	{/snippet}
</Story>
