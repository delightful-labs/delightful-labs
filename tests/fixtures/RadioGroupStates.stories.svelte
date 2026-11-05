<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import RadioGroupStates from './RadioGroupStates.svelte'

	const { Story } = defineMeta({
		title: 'Tests/RadioGroup',
		component: RadioGroupStates
	})
</script>

<Story name="External form" />
