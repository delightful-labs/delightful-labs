<script lang="ts">
	import { InputCurrency, InputDate, InputText, Select, FieldFeedback } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import type { Account, TransactionDetail } from '#lib/schema.js'
	import { amountInputPattern, minorUnitsToInput } from '#lib/domain/money.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		accounts,
		initialTransaction,
		defaultAccountId,
		selectedAccountId = $bindable(''),
		idPrefix = 'transaction',
		disabled = false,
		hideEmptyDescription = false,
		accountLabel = m['nouns.account']({ count: 1 }),
		amountLabel = m['labels.amount'](),
		dateLabel = m['nouns.date']({ count: 1 }),
		issues = [],
		afterAccount,
		afterDate
	}: {
		accounts: readonly Account[]
		initialTransaction?:
			| (Pick<TransactionDetail, 'accountId' | 'amountMinor' | 'currency' | 'bookedOn'> &
					Partial<Pick<TransactionDetail, 'description'>> & {
						accountName?: Account['name'] | undefined
					})
			| undefined
		defaultAccountId?: Account['id'] | undefined
		selectedAccountId?: string
		idPrefix?: string
		disabled?: boolean
		hideEmptyDescription?: boolean
		accountLabel?: string
		amountLabel?: string
		dateLabel?: string
		issues?: readonly { path: readonly PropertyKey[] }[]
		afterAccount?: Snippet
		afterDate?: Snippet
	} = $props()
	const selectedAccountCurrency = $derived(
		accounts.find((account) => account.id === selectedAccountId)?.currency ??
			initialTransaction?.currency ??
			'USD'
	)
	function fieldInvalid(issues: readonly { path: readonly PropertyKey[] }[], field: string) {
		return issues.some(
			({ path }) => path[0] === field || (field === 'amount' && path[0] === 'money')
		)
	}
</script>

<Select
	label={accountLabel}
	id="{idPrefix}-account"
	aria-describedby="{idPrefix}-account-feedback"
	aria-invalid={fieldInvalid(issues, 'accountId') || undefined}
	{disabled}
	name="accountId"
	required={!disabled}
	defaultValue={initialTransaction?.accountId ?? defaultAccountId ?? ''}
	bind:value={selectedAccountId}
>
	<option value="" disabled
		>{m['actions.select_subject']({ subject: m['nouns.account']({ count: 1 }) })}</option
	>
	{#if initialTransaction && !accounts.some((account) => account.id === initialTransaction?.accountId)}
		<option value={initialTransaction.accountId} disabled
			>{initialTransaction.accountName ??
				m['status.unavailable_subject']({
					subject: m['nouns.account']({ count: 1 })
				})} · {initialTransaction.currency}</option
		>
	{/if}
	{#each accounts as account (account.id)}
		<option value={account.id}>{account.name} · {account.currency}</option>
	{/each}
</Select>
<FieldFeedback
	id="{idPrefix}-account-feedback"
	errorMessage={fieldInvalid(issues, 'accountId')
		? m['forms.select_subject']({ subject: m['nouns.account']({ count: 1 }) })
		: ''}
/>

{@render afterAccount?.()}

<InputCurrency
	{...disabled && initialTransaction
		? { value: minorUnitsToInput(initialTransaction.amountMinor, initialTransaction.currency) }
		: {}}
	label={amountLabel}
	currencyLabel={disabled && initialTransaction
		? initialTransaction.currency
		: selectedAccountCurrency}
	id="{idPrefix}-amount"
	aria-describedby="{idPrefix}-amount-feedback"
	aria-invalid={fieldInvalid(issues, 'amount') || undefined}
	{disabled}
	name="amount"
	inputmode="decimal"
	autocomplete="off"
	pattern={amountInputPattern(selectedAccountCurrency)}
	defaultValue={initialTransaction
		? minorUnitsToInput(initialTransaction.amountMinor, initialTransaction.currency)
		: ''}
	required={!disabled}
/>
<FieldFeedback
	id="{idPrefix}-amount-feedback"
	errorMessage={fieldInvalid(issues, 'amount')
		? m['forms.enter_subject']({ subject: m['labels.amount']() })
		: ''}
/>

<InputDate
	{...disabled && initialTransaction ? { value: initialTransaction.bookedOn } : {}}
	label={dateLabel}
	id="{idPrefix}-date"
	aria-describedby="{idPrefix}-date-feedback"
	aria-invalid={fieldInvalid(issues, 'bookedOn') || undefined}
	{disabled}
	name="bookedOn"
	defaultValue={initialTransaction?.bookedOn ?? todayDateOnly()}
	required={!disabled}
/>
<FieldFeedback
	id="{idPrefix}-date-feedback"
	errorMessage={fieldInvalid(issues, 'bookedOn')
		? m['forms.enter_subject']({ subject: m['nouns.date']({ count: 1 }) })
		: ''}
/>

{@render afterDate?.()}
{#if !hideEmptyDescription || initialTransaction?.description}
	<InputText
		{...disabled ? { value: initialTransaction?.description ?? '' } : {}}
		label={m['labels.description']()}
		id="{idPrefix}-description"
		{disabled}
		name="description"
		defaultValue={initialTransaction?.description ?? ''}
	/>
{/if}
