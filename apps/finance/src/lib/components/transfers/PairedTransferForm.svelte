<script lang="ts">
	import { Button, FieldFeedback, InputCurrency, InputDate, Select } from 'delightful-ui'
	import { untrack } from 'svelte'
	import type { Account } from '#lib/schema.js'
	import type { InternalTransferEntryView } from '#lib/contracts/transfer-create-contract.js'
	import { amountInputPattern } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { m } from '#lib/paraglide/messages.js'
	import { internalTransferEntryReasonLabels } from '#lib/machines/transfers/internal-transfer-entry.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import FormContent from '../forms/FormContent.svelte'

	let {
		accounts,
		view,
		onsubmit,
		onreset,
		oninput
	}: {
		accounts: readonly Account[]
		view: InternalTransferEntryView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oninput: (event: Event) => void
	} = $props()
	let expenseAccountId = $state('')
	let incomeAccountId = $state('')
	let sharedAmount = $state('')
	let expenseAmount = $state('')
	let incomeAmount = $state('')
	const draftRevision = $derived(view.draftRevision)
	$effect(() => {
		void draftRevision
		untrack(() => {
			expenseAccountId = accounts[0]?.id ?? ''
			incomeAccountId = accounts[1]?.id ?? ''
		})
	})
	const expenseAccount = $derived(accounts.find((account) => account.id === expenseAccountId))
	const incomeAccount = $derived(accounts.find((account) => account.id === incomeAccountId))
	const differentCurrencies = $derived(
		Boolean(expenseAccount && incomeAccount && expenseAccount.currency !== incomeAccount.currency)
	)
	function fieldInvalid(path: string) {
		return (
			view.feedback.kind === 'result' &&
			view.feedback.result.outcome === 'invalid' &&
			view.feedback.result.issues.some((issue) => issue.path[0] === path)
		)
	}
</script>

<FormContent {view} {onsubmit} {onreset} {oninput}>
	{#snippet fields(form)}
		{#if form.content.kind !== 'success'}
			<Select
				label={m['transfers.source_subject']({ subject: m['nouns.account']({ count: 1 }) })}
				id="transfer-expense-account"
				name="expenseAccountId"
				required
				bind:value={expenseAccountId}
			>
				<option value="" disabled
					>{m['actions.select_subject']({ subject: m['nouns.account']({ count: 1 }) })}</option
				>
				{#each accounts as account (account.id)}
					<option value={account.id}>{account.name} · {account.currency}</option>
				{/each}
			</Select>
			<Select
				label={m['transfers.destination_subject']({ subject: m['nouns.account']({ count: 1 }) })}
				id="transfer-income-account"
				name="incomeAccountId"
				required
				bind:value={incomeAccountId}
			>
				<option value="" disabled
					>{m['actions.select_subject']({ subject: m['nouns.account']({ count: 1 }) })}</option
				>
				{#each accounts as account (account.id)}
					<option value={account.id}>{account.name} · {account.currency}</option>
				{/each}
			</Select>
			<input type="hidden" name="amountMode" value={differentCurrencies ? 'separate' : 'shared'} />
			{#if differentCurrencies}
				<input type="hidden" name="expenseCurrency" value={expenseAccount?.currency ?? 'USD'} />
				<input type="hidden" name="incomeCurrency" value={incomeAccount?.currency ?? 'USD'} />
				<InputCurrency
					label={m['transfers.source_subject']({ subject: m['labels.amount']() })}
					currencyLabel={expenseAccount?.currency ?? 'USD'}
					id="transfer-expense-amount"
					name="expenseAmount"
					bind:value={expenseAmount}
					inputmode="decimal"
					autocomplete="off"
					pattern={amountInputPattern(expenseAccount?.currency ?? 'USD')}
					aria-invalid={fieldInvalid('expenseAmount') || undefined}
					required
				/>
				<FieldFeedback
					id="transfer-expense-amount-feedback"
					errorMessage={fieldInvalid('expenseAmount')
						? m['forms.enter_subject']({ subject: m['labels.amount']() })
						: ''}
				/>
				<InputCurrency
					label={m['transfers.destination_subject']({ subject: m['labels.amount']() })}
					currencyLabel={incomeAccount?.currency ?? 'USD'}
					id="transfer-income-amount"
					name="incomeAmount"
					bind:value={incomeAmount}
					inputmode="decimal"
					autocomplete="off"
					pattern={amountInputPattern(incomeAccount?.currency ?? 'USD')}
					aria-invalid={fieldInvalid('incomeAmount') || undefined}
					required
				/>
				<FieldFeedback
					id="transfer-income-amount-feedback"
					errorMessage={fieldInvalid('incomeAmount')
						? m['forms.enter_subject']({ subject: m['labels.amount']() })
						: ''}
				/>
			{:else}
				<input type="hidden" name="currency" value={expenseAccount?.currency ?? 'USD'} />
				<InputCurrency
					label={m['labels.amount']()}
					currencyLabel={expenseAccount?.currency ?? 'USD'}
					id="transfer-amount"
					name="amount"
					bind:value={sharedAmount}
					inputmode="decimal"
					autocomplete="off"
					pattern={amountInputPattern(expenseAccount?.currency ?? 'USD')}
					aria-invalid={fieldInvalid('amount') || undefined}
					required
				/>
				<FieldFeedback
					id="transfer-amount-feedback"
					errorMessage={fieldInvalid('amount')
						? m['forms.enter_subject']({ subject: m['labels.amount']() })
						: ''}
				/>
			{/if}
			<InputDate
				label={m['nouns.date']({ count: 1 })}
				id="transfer-booked-on"
				name="bookedOn"
				defaultValue={todayDateOnly()}
				aria-invalid={fieldInvalid('bookedOn') || undefined}
				required
			/>
		{/if}
	{/snippet}
	{#snippet controls(form)}
		{#if form.content.kind === 'success'}
			<Button type="reset"
				>{m['actions.add_another_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}</Button
			>
		{:else}
			<Button type="submit" variant="primary" disabled={!form.canSubmit}>
				{m['actions.save_subject']({ subject: m['nouns.transfer']({ count: 1 }) })}
			</Button>
		{/if}
	{/snippet}
	{#snippet feedback()}
		<FormFeedback
			{view}
			subject={m['nouns.transfer']({ count: 1 })}
			reasonText={(reason) => internalTransferEntryReasonLabels[reason]()}
			invalidMessage={m['forms.validation_error']()}
		/>
	{/snippet}
</FormContent>
