<script lang="ts">
	import Select from '../../src/lib/Components/Inputs/Select.svelte'
	let single = $state<string | undefined>('other')
	let multiple = $state<string[] | undefined>()
</script>

<form onsubmit={(event) => event.preventDefault()}>
	<Select
		label="Bound category"
		name="category"
		defaultValue="work"
		bind:value={single}
	>
		<option value="personal">Personal</option>
		<option value="work">Work</option>
		<option value="other">Other</option>
	</Select>
	<Select
		label="Bound channels"
		name="channel"
		multiple
		defaultValue={['work']}
		bind:value={multiple}
	>
		<option value="personal">Personal</option>
		<option value="work">Work</option>
		<option value="other">Other</option>
	</Select>
	<button
		type="button"
		onclick={() => {
			single = 'personal'
			multiple = ['personal', 'other']
		}}>Set selections</button
	>
	<button type="button" onclick={() => (multiple = [])}>Clear channels</button>
	<button type="reset">Reset bindings</button>
	<output aria-label="Category state">{single ?? 'undefined'}</output>
	<output aria-label="Channels state">{JSON.stringify(multiple)}</output>
</form>
