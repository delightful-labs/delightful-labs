<script lang="ts">
	import { Button, Checkbox } from 'delightful-ui'
	import type { Account } from '../../queries.js'
	import Icon from '../navigation/AppIcon.svelte'
	import ExpensesIcon from 'tdesign-icons-svg/src/arrow-up.svg?component'
	import IncomeIcon from 'tdesign-icons-svg/src/arrow-down.svg?component'
	import { formatSignedMoney } from '../../domain/money.js'
	import { getLocale } from '../../paraglide/runtime.js'
	import { m } from '../../paraglide/messages.js'
	let {
		accounts,
		accountBalances = null,
		selectedAccountIds,
		onAccountChange,
		onAllAccountsChange,
		ordering
	}: {
		accounts: readonly Pick<Account, 'id' | 'name' | 'currency'>[]
		accountBalances?: ReadonlyMap<string, bigint> | null
		selectedAccountIds: readonly string[] | null
		onAccountChange: (accountId: string, checked: boolean) => void
		onAllAccountsChange: (checked: boolean) => void
		ordering?:
			| {
					editing: boolean
					canToggle: boolean
					canMove: (id: string, direction: 'up' | 'down') => boolean
					onMove: (id: string, direction: 'up' | 'down') => void
					onEdit: () => void
					onDone: () => void
			  }
			| undefined
	} = $props()
</script>

<fieldset class="account-filters">
	<legend
		>{m['actions.filter_subject']({
			subject: m['nouns.account']({ count: 2 })
		})}</legend
	>
	<ul>
		<li class="account-filter">
			<Checkbox
				name="accountIds"
				value="all"
				checked={selectedAccountIds === null ||
					accounts.every((account) => selectedAccountIds?.includes(account.id))}
				label={m['labels.all_subjects']({
					subjects: m['nouns.account']({ count: 2 })
				})}
				onchange={(event) => onAllAccountsChange(event.currentTarget.checked)}
			/>
		</li>
		{#each accounts as account (account.id)}
			<li class="account-filter">
				<Checkbox
					name="accountIds"
					value={account.id}
					checked={selectedAccountIds === null || selectedAccountIds.includes(account.id)}
					label={account.name}
					onchange={(event) => onAccountChange(account.id, event.currentTarget.checked)}
				/>
				<span class="account-balance" title={m['labels.calculated_balance']()}>
					{accountBalances === null
						? '—'
						: formatSignedMoney(
								accountBalances.get(account.id) ?? 0n,
								account.currency,
								getLocale()
							)}
				</span>
				{#if ordering?.editing}
					<span class="account-order-controls">
						<Button
							type="button"
							appearance="flat"
							disabled={!ordering?.canMove(account.id, 'up')}
							aria-label={m['actions.move_up_name']({ name: account.name })}
							onclick={() => ordering?.onMove(account.id, 'up')}
							><Icon icon={ExpensesIcon} style="width: 1rem; height: 1rem;" /></Button
						>
						<Button
							type="button"
							appearance="flat"
							disabled={!ordering?.canMove(account.id, 'down')}
							aria-label={m['actions.move_down_name']({ name: account.name })}
							onclick={() => ordering?.onMove(account.id, 'down')}
							><Icon icon={IncomeIcon} style="width: 1rem; height: 1rem;" /></Button
						>
					</span>
				{/if}
			</li>
		{/each}
	</ul>
</fieldset>
{#if ordering?.canToggle}
	<Button
		type="button"
		appearance="flat"
		aria-pressed={ordering.editing}
		onclick={ordering.editing ? ordering.onDone : ordering.onEdit}
		>{ordering.editing
			? m['status.done']()
			: m['actions.edit_subject']({
					subject: m['nouns.order']({ count: 1 })
				})}</Button
	>
{/if}

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.account-filters {
		margin: 0;
		padding: 0;
		border: 0;
		min-inline-size: 0;
	}

	legend {
		font-size: var(--dui-font-size-sm, 0.875rem);
	}

	.account-filter {
		display: flex;
		align-items: center;
		gap: var(--dui-space-xs, 0.5rem);
	}

	.account-balance {
		font-size: var(--dui-font-size-xs, 0.75rem);
	}

	.account-order-controls {
		margin-inline-start: auto;
		display: flex;
	}
</style>
