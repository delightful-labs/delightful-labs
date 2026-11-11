<script lang="ts">
	import { Button, InputText, Select } from 'delightful-ui'
	import { ACCOUNT_CURRENCY, type AccountCurrency } from '#lib/domain/account-currency.js'
	import type {
		WorkspaceRenameReason,
		WorkspaceRenameView
	} from '#lib/contracts/workspace-rename-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import FormContent from '../forms/FormContent.svelte'
	import FormFeedback from '../forms/FormFeedback.svelte'

	let {
		name,
		defaultCurrency,
		view,
		onsubmit,
		onreset,
		oninput,
		onRetryReadiness
	}: {
		name: string
		defaultCurrency: AccountCurrency
		view: WorkspaceRenameView
		onsubmit: (event: SubmitEvent) => void
		oninput: (event: Event) => void
		onreset: (event: Event) => void
		onRetryReadiness: () => void
	} = $props()
	const explanations: Record<WorkspaceRenameReason, () => string> = {
		sessionUnavailable: () => m['forms.session_unavailable'](),
		selectWorkspace: () =>
			m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		loadFailed: () =>
			m['errors.load_subject']({
				subject: m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })
			}),
		loading: () =>
			m['status.loading_subject']({
				subject: m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })
			}),
		workspaceUnavailable: () =>
			m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		readOnly: () => m['forms.read_only']()
	}
	const currencyOptions: readonly { code: AccountCurrency; label: () => string }[] = [
		{ code: ACCOUNT_CURRENCY.USD, label: () => m['currencies.us_dollar']() },
		{ code: ACCOUNT_CURRENCY.TZS, label: () => m['currencies.tanzanian_shilling']() }
	]
</script>

{#snippet formFeedback(section: 'readiness' | 'result')}
	<FormFeedback
		{view}
		{section}
		subject={section === 'readiness'
			? m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })
			: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })}
		reasonText={(reason) => explanations[reason]()}
		invalidMessage={m['forms.enter_subject']({
			subject: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
		})}
		successMessage={() => m['workspace.settings_saved']()}
		{onRetryReadiness}
		blockedRole={(reason) => (reason === 'loadFailed' ? 'alert' : 'status')}
	/>
{/snippet}
{@render formFeedback('readiness')}

<FormContent {view} {onsubmit} {onreset} {oninput}>
	{#snippet fields(form)}
		<InputText
			label={m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })}
			id="workspace-name"
			name="name"
			value={name}
			required
			disabled={!form.fieldsEditable || view.readiness.kind !== 'ready'}
		/>
		<Select
			label={m['labels.currency']()}
			id="workspace-default-currency"
			name="defaultCurrency"
			value={defaultCurrency}
			required
			disabled={!form.fieldsEditable || view.readiness.kind !== 'ready'}
		>
			{#each currencyOptions as currency (currency.code)}
				<option value={currency.code}>{currency.label()} ({currency.code})</option>
			{/each}
		</Select>
	{/snippet}
	{#snippet controls(form)}
		<Button type="submit" disabled={!form.canSubmit}>
			{m['actions.save']()}
		</Button>
	{/snippet}
	{#snippet feedback()}
		{@render formFeedback('result')}
	{/snippet}
</FormContent>
