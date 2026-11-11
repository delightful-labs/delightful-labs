<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import StatusMessage from '#lib/Components/StatusMessage.svelte'

	const { Story } = defineMeta({
		title: 'Feedback/StatusMessage',
		component: StatusMessage,
		tags: ['autodocs'],
		args: { text: 'Changes are saved on this device.', compact: false },
		argTypes: {
			compact: {
				control: 'boolean',
				description:
					'Compact text with a decorative status dot or loading spinner.'
			},
			variant: {
				control: 'select',
				options: ['info', 'loading', 'success', 'error']
			}
		}
	})
</script>

<Story name="Information" />
<Story
	name="Loading"
	args={{ variant: 'loading', text: 'Loading accounts…' }}
/>
<Story
	name="Success"
	args={{ variant: 'success', text: 'Transaction saved.' }}
/>
<Story
	name="Error"
	args={{
		variant: 'error',
		text: 'Could not save the transaction. Try again.'
	}}
/>
<Story
	name="Wrapping"
	args={{
		variant: 'loading',
		text: 'Loading accounts and categories for the selected workspace. This message wraps within the available width.',
		style: 'max-inline-size: 18rem;'
	}}
/>
<Story
	name="Without announcement"
	args={{ role: 'presentation', text: 'No accounts yet.' }}
/>

<Story
	name="Compact saved locally"
	args={{ compact: true, text: 'Saved on this device' }}
/>
<Story
	name="Compact offline"
	args={{ compact: true, text: 'Offline — changes stay on this device' }}
/>
<Story
	name="Compact pending"
	args={{ compact: true, text: 'Changes waiting to sync' }}
/>
<Story
	name="Compact connecting"
	args={{ compact: true, variant: 'loading', text: 'Connecting…' }}
/>
<Story
	name="Compact syncing"
	args={{ compact: true, variant: 'loading', text: 'Syncing changes…' }}
/>
<Story
	name="Compact synced"
	args={{ compact: true, variant: 'success', text: 'All changes synced' }}
/>
<Story
	name="Compact error"
	args={{
		compact: true,
		variant: 'error',
		text: 'Changes could not sync. Try again.'
	}}
/>
<Story
	name="Compact wrapping"
	args={{
		compact: true,
		text: 'Offline — your changes are saved on this device and will sync when the connection returns.',
		style: 'max-inline-size: 18rem;'
	}}
/>
