<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Button from '#lib/Components/Button.svelte'
	import ButtonContent from '#lib/Components/ButtonContent.svelte'
	import RefreshIcon from 'tdesign-icons-svg/src/refresh.svg?component'

	const { Story } = defineMeta({
		title: 'Controls/ButtonContent',
		component: ButtonContent,
		tags: ['autodocs'],
		args: { icon: RefreshIcon, text: 'Sync bank accounts', loading: false }
	})
</script>

<Story name="Default">
	{#snippet template(args)}
		<Button disabled={args.loading} aria-busy={args.loading}>
			<ButtonContent {...args} />
		</Button>
	{/snippet}
</Story>

<Story name="Loading" args={{ loading: true }}>
	{#snippet template(args)}
		<Button disabled={args.loading} aria-busy={args.loading}>
			<ButtonContent {...args} />
		</Button>
	{/snippet}
</Story>
