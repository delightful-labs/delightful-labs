<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Stepper from '#lib/Components/Stepper.svelte'

	const { Story } = defineMeta({
		title: 'Layout/Stepper',
		component: Stepper,
		tags: ['autodocs'],
		args: {
			label: 'Application progress',
			currentStep: 'documents'
		}
	})
</script>

<Story name="Application progress">
	{#snippet template(args)}
		<Stepper
			{...args}
			steps={[
				{ id: 'personal', label: 'Personal information', status: 'completed' },
				{ id: 'household', label: 'Household status', status: 'completed' },
				{ id: 'documents', label: 'Supporting documents' },
				{ id: 'signature', label: 'Signature' },
				{ id: 'review', label: 'Review and submit' }
			]}
		/>
	{/snippet}
</Story>

<Story name="Long labels">
	{#snippet template(args)}
		<div style="max-inline-size: 32rem;">
			<Stepper
				{...args}
				steps={[
					{
						id: 'one',
						label: 'Personal information and contact details',
						status: 'completed'
					},
					{ id: 'two', label: 'Supporting documents and evidence' },
					{ id: 'three', label: 'Review and submit your application' }
				]}
				currentStep="two"
			/>
		</div>
	{/snippet}
</Story>
