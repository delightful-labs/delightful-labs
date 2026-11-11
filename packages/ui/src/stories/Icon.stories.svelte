<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Icon from '#lib/Components/Icon.svelte'
	import RefreshIcon from 'tdesign-icons-svg/src/refresh.svg?component'

	const { Story } = defineMeta({
		title: 'Content/Icon',
		component: Icon,
		tags: ['autodocs']
	})
</script>

<Story name="Default">
	{#snippet template()}
		<Icon style="width: 2rem; height: 2rem;">
			<path d="M5 12h14M13 6l6 6-6 6" />
		</Icon>
	{/snippet}
</Story>
<Story name="Imported SVG" args={{ icon: RefreshIcon }}>
	{#snippet template(args)}
		<Icon {...args} style="width: 2rem; height: 2rem;" />
	{/snippet}
</Story>
<Story name="Labeled" args={{ label: 'Continue' }}>
	{#snippet template(args)}
		<Icon {...args} style="width: 2rem; height: 2rem;">
			<path d="M5 12h14M13 6l6 6-6 6" />
		</Icon>
	{/snippet}
</Story>
