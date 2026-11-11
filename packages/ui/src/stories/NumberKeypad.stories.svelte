<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import NumberKeypad from '#lib/Components/NumberKeypad.svelte'

	const { Story } = defineMeta({
		title: 'Controls/NumberKeypad',
		component: NumberKeypad,
		args: {
			label: 'Number keypad',
			decimalLabel: 'Decimal separator',
			backspaceLabel: 'Delete last digit',
			nextLabel: 'Next'
		}
	})
</script>

<script lang="ts">
	import type { NumberKeypadKey } from '#lib'
	let lastKey = $state<NumberKeypadKey | undefined>()
</script>

{#snippet example(
	args: Omit<import('svelte').ComponentProps<typeof NumberKeypad>, 'onkey'>
)}
	<div class="example">
		<NumberKeypad {...args} onkey={(key) => (lastKey = key)} />
		<output aria-label="Last key">{lastKey ?? 'No key pressed'}</output>
	</div>
{/snippet}

<Story name="Default" template={example} />
<Story
	name="Rectangular keys"
	args={{ style: '--dui-number-keypad-key-aspect-ratio: 3 / 2;' }}
	template={example}
/>
<Story
	name="Decimal comma"
	args={{ decimalSeparator: ',' }}
	template={example}
/>
<Story name="Next disabled" args={{ nextDisabled: true }} template={example} />
<Story name="Disabled" args={{ disabled: true }} template={example} />

<style>
	.example {
		inline-size: 100%;
		max-inline-size: 32rem;
	}

	output {
		display: block;
		margin-block-start: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}
</style>
