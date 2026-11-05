<script lang="ts">
	import { RadioGroup, RadioItem, Button, Checkbox } from '#lib'

	let selected = $state<string | undefined>('month')
	let defaultValue = $state<string | undefined>('week')
	let cancelReset = $state(false)
	let disabled = $state(false)
	let submitted = $state('No submission yet.')
	let changed = $state('No changes yet.')
</script>

<form
	id="radio-owner"
	onsubmit={(event) => {
		event.preventDefault()
		submitted = JSON.stringify(Array.from(new FormData(event.currentTarget)))
	}}
	onreset={(event) => {
		if (cancelReset) event.preventDefault()
	}}
>
	<Button type="submit">Submit</Button>
	<Button type="reset">Reset</Button>
</form>

<RadioGroup
	label="External view"
	name="view"
	form="radio-owner"
	{defaultValue}
	{disabled}
	bind:value={selected}
	onchange={(event) => {
		changed = `${event.currentTarget.name}:${event.currentTarget.value}`
	}}
>
	<RadioItem value="day">Day</RadioItem>
	<RadioItem value="week">Week</RadioItem>
	<RadioItem value="month">Month</RadioItem>
</RadioGroup>
<Checkbox label="Cancel reset" bind:checked={cancelReset} />
<Button onclick={() => (disabled = !disabled)}>Toggle disabled</Button>
<Button onclick={() => (defaultValue = undefined)}>Remove default</Button>
<output aria-label="Selected view">{selected ?? 'None'}</output>
<output aria-label="Last change">{changed}</output>
<pre aria-live="polite">{submitted}</pre>
