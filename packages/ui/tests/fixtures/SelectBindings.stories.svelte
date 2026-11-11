<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import SelectBindings from './SelectBindings.svelte'
	const { Story } = defineMeta({
		title: 'Tests/SelectBindings',
		component: SelectBindings
	})
</script>

<Story name="Default" />
