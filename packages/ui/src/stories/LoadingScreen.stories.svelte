<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import LoadingScreen from '#lib/Components/LoadingScreen.svelte'

	const { Story } = defineMeta({
		title: 'Feedback/LoadingScreen',
		component: LoadingScreen,
		tags: ['autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			text: 'Loading your finances…'
		},
		argTypes: {
			variant: { control: 'select', options: ['loading', 'error'] }
		}
	})
</script>

<Story name="Loading" />
<Story
	name="Error"
	args={{
		variant: 'error',
		text: 'Your data could not be opened. Refresh the page to try again.'
	}}
/>
<Story
	name="Contained"
	args={{
		style:
			'--dui-loading-screen-min-height: 20rem; --dui-loading-screen-content-width: 18rem;',
		text: 'Preparing your profile, accounts and starter categories on this device.'
	}}
/>
