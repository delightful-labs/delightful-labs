<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputNumber from '#lib/Components/Inputs/InputNumber.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Number',
		component: InputNumber,
		tags: ['autodocs'],
		args: { label: 'Quantity', name: 'quantity' }
	})
</script>

<Story name="Default" args={{ defaultValue: 0, min: 0, max: 100 }} />
<Story name="Decimal" args={{ defaultValue: 1.25, step: 0.01 }} />
<Story name="Without arrows" args={{ hideArrows: true }} />
