<script lang="ts">
	import type { Snippet } from 'svelte'
	import { INCOME, EXPENSE } from '#lib/domain/transaction-kind.js'
	import { InputText, Select } from 'delightful-ui'
	import type { Category } from '#lib/schema.js'
	import type { ManagementView, ManagementScope } from '#lib/contracts/management-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	import FormModal from '../forms/FormModal.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'
	let {
		scope,
		view,
		onopen,
		onsubmit,
		onreset,
		onRetryReadiness,
		fixedKind,
		trigger
	}: {
		scope: ManagementScope
		view: ManagementView<Category>
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
		fixedKind?: Category['kind']
		trigger?: Snippet<[() => void, boolean]>
	} = $props()
	let modal: { openModal: () => void } | undefined = $state()
	export function open() {
		modal?.openModal()
	}
</script>

<FormFeedback
	{view}
	subject={m['nouns.category']({ count: 1 })}
	reasonText={(reason) => formReasonText[reason]()}
	invalidMessages={[
		m['forms.enter_subject']({
			subject: m['labels.subject_name']({ subject: m['nouns.category']({ count: 1 }) })
		}),
		...(fixedKind
			? []
			: [
					m['forms.select_subject']({
						subject: m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })
					})
				])
	]}
	section="readiness"
	{onRetryReadiness}
/>
<FormModal
	bind:this={modal}
	{trigger}
	{scope}
	label={m['actions.add_subject']({ subject: m['nouns.category']({ count: 1 }) })}
	{view}
	{onopen}
	{onsubmit}
	{onreset}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.subject_name']({ subject: m['nouns.category']({ count: 1 }) })}
			id="category-name"
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		{#if fixedKind}
			<input type="hidden" name="kind" value={fixedKind} />
		{:else}
			<Select
				label={m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })}
				id="category-kind"
				name="kind"
				required
				disabled={!form.fieldsEditable}
				defaultValue={EXPENSE}
			>
				<option value={EXPENSE}>{m['nouns.expense']({ count: 2 })}</option>
				<option value={INCOME}>{m['nouns.income']({ count: 1 })}</option>
			</Select>
		{/if}
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['nouns.category']({ count: 1 })}
			reasonText={(reason) => formReasonText[reason]()}
			invalidMessages={[
				m['forms.enter_subject']({
					subject: m['labels.subject_name']({ subject: m['nouns.category']({ count: 1 }) })
				}),
				...(fixedKind
					? []
					: [
							m['forms.select_subject']({
								subject: m['labels.subject_type']({ subject: m['nouns.transaction']({ count: 1 }) })
							})
						])
			]}
			successMessage={(value) =>
				m['status.saved_subject_name']({
					subject: m['nouns.category']({ count: 1 }),
					name: value.name
				})}
			section="all"
		/>
	{/snippet}
</FormModal>
