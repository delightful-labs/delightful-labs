<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import RecoveryPhraseExample from './RecoveryPhraseExample.svelte'
	import { createRecoveryMessages } from '../src/lib/localization/recovery.js'

	const { Story } = defineMeta({
		title: 'Identity/Recovery phrase',
		component: RecoveryPhraseExample,
		parameters: {
			docs: {
				description: {
					component:
						'Synthetic data only. The view receives messages and callbacks; the example owns a recovery actor without Jazz.'
				}
			}
		},
		args: { available: true, fail: false }
	})
</script>

<Story name="Reveal and close" />
<Story name="Unavailable" args={{ available: false }} />
<Story name="Retry a failure" args={{ fail: true, withControls: true }} />
<Story
	name="Consumer wording"
	args={{
		messages: createRecoveryMessages('en', {
			description:
				'This example replaces the library description without sharing an app catalog.'
		})
	}}
/>
<Story name="Independent instances" asChild>
	<RecoveryPhraseExample />
	<RecoveryPhraseExample
		messages={createRecoveryMessages('en', { show: 'Show another recovery phrase' })}
	/>
</Story>

<Story name="Host updates" args={{ withControls: true }} />
