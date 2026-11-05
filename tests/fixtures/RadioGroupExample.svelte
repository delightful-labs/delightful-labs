<script lang="ts">
	import type { ComponentProps } from 'svelte'
	import { RadioGroup, RadioItem } from '#lib'

	let {
		includeEmpty = false,
		...attributes
	}: Omit<ComponentProps<typeof RadioGroup>, 'children'> & {
		includeEmpty?: boolean
	} = $props()
</script>

<RadioGroup {...attributes}>
	{#if includeEmpty}<RadioItem value="">None</RadioItem>{/if}
	<RadioItem value="day">Day &amp; night</RadioItem>
	<RadioItem value="week">Week</RadioItem>
	<RadioItem value="month" disabled>Month</RadioItem>
</RadioGroup>
