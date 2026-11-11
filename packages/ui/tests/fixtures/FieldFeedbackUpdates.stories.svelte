<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import FieldFeedbackUpdates from './FieldFeedbackUpdates.svelte'
	const { Story } = defineMeta({
		title: 'Tests/FieldFeedbackUpdates',
		component: FieldFeedbackUpdates
	})
</script>

<Story name="Default" />
