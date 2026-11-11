<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import StatusMessageStates from './StatusMessageStates.svelte'
	const { Story } = defineMeta({
		title: 'Tests/StatusMessageStates',
		component: StatusMessageStates
	})
</script>

<Story name="Default" />

<Story name="Compact" args={{ compact: true }} />
