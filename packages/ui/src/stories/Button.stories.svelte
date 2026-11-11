<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Button from '#lib/Components/Button.svelte'
	import ArrowRightIcon from 'tdesign-icons-svg/src/arrow-right.svg?component'

	const { Story } = defineMeta({
		title: 'Controls/Button',
		component: Button,
		tags: ['autodocs'],
		args: { text: 'Save' }
	})
</script>

<Story name="Default" />
<Story name="Primary" args={{ variant: 'primary' }} />
<Story name="Secondary" args={{ variant: 'secondary' }} />
<Story name="Destructive" args={{ variant: 'destructive' }} />
<Story name="Primary flat" args={{ variant: 'primary', appearance: 'flat' }} />
<Story name="Flat secondary" args={{ appearance: 'flat' }} />
<Story name="Flat disabled" args={{ appearance: 'flat', disabled: true }} />
<Story name="ARIA disabled" args={{ 'aria-disabled': 'true' }} />
<Story
	name="Flat key"
	args={{
		appearance: 'flat',
		text: '7',
		style:
			'--dui-button-font-size: var(--dui-font-size-xxl, 1.5rem); inline-size: 100%; aspect-ratio: 1;'
	}}
>
	{#snippet template(args)}
		<div class="key-example">
			<Button {...args} />
		</div>
	{/snippet}
</Story>
<Story name="Disabled" args={{ disabled: true }} />
<Story name="Children">
	{#snippet template(args)}
		<Button {...args}>Save changes</Button>
	{/snippet}
</Story>
<Story name="With icon">
	{#snippet template(args)}
		<Button {...args}>
			<ArrowRightIcon
				aria-hidden="true"
				focusable="false"
				style="width: 1em; height: 1em; vertical-align: -0.125em;"
			/>
			Continue
		</Button>
	{/snippet}
</Story>

<style>
	.key-example {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem));
		max-inline-size: 32rem;
	}
</style>
