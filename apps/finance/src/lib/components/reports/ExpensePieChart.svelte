<script lang="ts">
	import { Chart, Arc, Group } from 'layerchart'
	import { Spring, prefersReducedMotion } from 'svelte/motion'
	import { untrack } from 'svelte'

	let {
		data,
		onselect
	}: {
		data: readonly { key: string; value: number; color: string }[]
		onselect: (key: string) => void
	} = $props()

	// Keep every category in a stable order, including zero-value categories.
	// One shared set of boundaries keeps neighboring slices joined during motion.
	const targets = $derived.by(() => {
		const total = data.reduce((sum, row) => sum + row.value, 0)
		let amount = 0
		return [
			0,
			...data.map((row) => {
				amount += row.value
				return total > 0 ? (amount / total) * Math.PI * 2 : 0
			})
		]
	})
	const spring = new Spring(untrack(() => targets))
	$effect(() => {
		const next = targets
		const instant = prefersReducedMotion.current
		untrack(() => {
			void spring.set(next, { instant })
		})
	})
	const boundaries = $derived(spring.current)
</script>

<Chart {data} x="value" axis={false} grid={false} tooltipContext={false}>
	{#snippet marks()}
		<Group center>
			{#each data as row, index (row.key)}
				<Arc
					startAngle={boundaries[index] ?? 0}
					endAngle={boundaries[index + 1] ?? 0}
					innerRadius={0}
					fill={row.color}
					onclick={() => onselect(row.key)}
				/>
			{/each}
		</Group>
	{/snippet}
</Chart>
