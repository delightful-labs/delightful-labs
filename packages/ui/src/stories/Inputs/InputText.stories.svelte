<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import InputText from '#lib/Components/Inputs/InputText.svelte'

	const { Story } = defineMeta({
		title: 'Inputs/Text',
		component: InputText,
		tags: ['autodocs'],
		args: { label: 'Description', name: 'description' }
	})
</script>

<Story name="Default" args={{ defaultValue: 'Groceries' }} />
<Story name="Required" args={{ required: true, maxlength: 40 }} />
<Story name="Disabled" args={{ disabled: true, defaultValue: 'Unavailable' }} />
