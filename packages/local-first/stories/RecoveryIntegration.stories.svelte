<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import RecoveryIntegrationExample from './RecoveryIntegrationExample.svelte'

	const { Story } = defineMeta({
		title: 'Identity/Owned recovery integration',
		component: RecoveryIntegrationExample,
		parameters: {
			docs: {
				description: {
					component: 'Synthetic host observations and capabilities; no Jazz account or provider.'
				}
			}
		}
	})
</script>

<Story name="Host lifetime" />
