<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import FieldFeedback from '#lib/Components/Inputs/FieldFeedback.svelte'
	import InputText from '#lib/Components/Inputs/InputText.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/FieldFeedback',
		component: FieldFeedback,
		tags: ['autodocs'],
		args: {
			id: 'field-feedback',
			instructions: 'Enter the account name used on your statements.'
		}
	})
</script>

<Story name="Instructions" />
<Story
	name="Error"
	args={{ instructions: '', errorMessage: 'Enter an account name.' }}
/>
<Story
	name="Instructions and error"
	args={{ errorMessage: 'Enter an account name.' }}
/>
<Story name="Empty" args={{ instructions: '' }} />
<Story
	name="Wrapping"
	args={{
		instructions:
			'Use a recognizable name for this account. You can rename it later without changing its transaction history.',
		errorMessage: 'Enter a name before saving this account.',
		style: 'max-inline-size: 18rem;'
	}}
/>
<Story
	name="Linked to an input"
	args={{ id: 'account-name-feedback', errorMessage: 'Enter an account name.' }}
	parameters={{
		docs: {
			source: {
				code: `<InputText
  label="Account name"
  name="name"
  required
  aria-describedby="account-name-feedback"
  aria-invalid={true}
/>
<FieldFeedback
  id="account-name-feedback"
  instructions="Enter the account name used on your statements."
  errorMessage="Enter an account name."
/>`
			}
		}
	}}
>
	{#snippet template(args)}
		<div class="field-example">
			<InputText
				label="Account name"
				name="name"
				required
				aria-describedby={args.id}
				aria-invalid={Boolean(args.errorMessage)}
			/>
			<FieldFeedback {...args} />
		</div>
	{/snippet}
</Story>

<style>
	.field-example {
		display: grid;
		gap: var(--dui-field-gap, var(--dui-spacing-xxs, 0.25rem));
		max-inline-size: 28rem;
	}
</style>
