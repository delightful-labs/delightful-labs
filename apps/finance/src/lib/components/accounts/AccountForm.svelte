<script lang="ts">
	import { ACCOUNT_KIND } from '#lib/domain/account-kind.js'
	import { ACCOUNT_CURRENCY, type AccountCurrency } from '#lib/domain/account-currency.js'
	import type { Snippet } from 'svelte'
	import { InputText, Select } from 'delightful-ui'
	import type {
		AccountCreationReason,
		AccountCreationScope,
		AccountCreationView
	} from '#lib/contracts/account-creation-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormModal from '../forms/FormModal.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'
	let {
		scope,
		defaultCurrency,
		view,
		trigger,
		onopen,
		onsubmit,
		onreset,
		onRetryReadiness
	}: {
		scope: AccountCreationScope
		defaultCurrency: AccountCurrency
		view: AccountCreationView
		trigger?: Snippet<[() => void, boolean]> | undefined
		onopen: () => void
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
	} = $props()
	const formId = $props.id()
	const currencyOptions: readonly { code: AccountCurrency; label: () => string }[] = [
		{ code: ACCOUNT_CURRENCY.USD, label: () => m['currencies.us_dollar']() },
		{ code: ACCOUNT_CURRENCY.TZS, label: () => m['currencies.tanzanian_shilling']() }
	]
	const explanations: Record<AccountCreationReason, () => string> = {
		sessionUnavailable: () => m['accounts.create_session_unavailable'](),
		selectWorkspace: () =>
			m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		loadFailed: () => m['errors.load_subject']({ subject: m['nouns.account']({ count: 2 }) }),
		loading: () => m['status.loading_subject']({ subject: m['nouns.account']({ count: 2 }) }),
		duplicateName: () => m['forms.duplicate_name'](),
		readOnly: () => m['accounts.create_restricted']()
	}
</script>

<FormFeedback
	{view}
	subject={m['nouns.account']({ count: 1 })}
	reasonText={(reason) => explanations[reason]()}
	invalidMessages={[
		m['forms.enter_subject']({
			subject: m['labels.subject_name']({ subject: m['nouns.account']({ count: 1 }) })
		}),
		m['forms.select_subject']({
			subject: m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })
		})
	]}
	section="readiness"
	{onRetryReadiness}
/>
<FormModal
	{scope}
	{trigger}
	{view}
	{onopen}
	{onsubmit}
	{onreset}
	label={m['actions.add_subject']({ subject: m['nouns.account']({ count: 1 }) })}
>
	{#snippet fields(form)}
		<InputText
			label={m['labels.subject_name']({ subject: m['nouns.account']({ count: 1 }) })}
			id={`${formId}-name`}
			name="name"
			required
			disabled={!form.fieldsEditable}
		/>
		<Select
			label={m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })}
			id={`${formId}-kind`}
			name="kind"
			required
			disabled={!form.fieldsEditable}
			defaultValue=""
		>
			<option value="" disabled
				>{m['actions.select_subject']({
					subject: m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })
				})}</option
			>
			<option value={ACCOUNT_KIND.CASH}>{m['labels.cash']()}</option>
			<option value={ACCOUNT_KIND.BANK}>{m['accounts.type.bank']()}</option>
			<option value={ACCOUNT_KIND.CARD}>{m['accounts.type.card']()}</option>
		</Select>
		{#key defaultCurrency}
			<Select
				label={m['labels.currency']()}
				id={`${formId}-currency`}
				name="currency"
				required
				disabled={!form.fieldsEditable}
				defaultValue={defaultCurrency}
			>
				{#each currencyOptions as currency (currency.code)}
					<option value={currency.code}>{currency.label()} ({currency.code})</option>
				{/each}
			</Select>
		{/key}
	{/snippet}
	{#snippet feedback(view)}
		<FormFeedback
			{view}
			subject={m['nouns.account']({ count: 1 })}
			reasonText={(reason) => explanations[reason]()}
			invalidMessages={[
				m['forms.enter_subject']({
					subject: m['labels.subject_name']({ subject: m['nouns.account']({ count: 1 }) })
				}),
				m['forms.select_subject']({
					subject: m['labels.subject_type']({ subject: m['nouns.account']({ count: 1 }) })
				})
			]}
			successMessage={(value) =>
				m['status.saved_subject_name']({
					subject: m['nouns.account']({ count: 1 }),
					name: value.name
				})}
		/>
	{/snippet}
</FormModal>
