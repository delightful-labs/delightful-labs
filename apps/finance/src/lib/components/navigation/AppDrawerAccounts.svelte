<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import Icon from './AppIcon.svelte'
	import AppNavigationLink from './AppNavigationLink.svelte'
	import { Button, ButtonContent, NavigationGroup, Navigation, Checkbox } from 'delightful-ui'
	import { type ComponentProps, type Snippet } from 'svelte'
	import type { Account } from '#lib/schema.js'
	import { formatSignedMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	import AppDrawerContentSection from './AppDrawerContentSection.svelte'
	import QueryContent from '../shared/QueryContent.svelte'
	import ExpensesIcon from 'tdesign-icons-svg/src/arrow-up.svg?component'
	import IncomeIcon from 'tdesign-icons-svg/src/arrow-down.svg?component'
	import AccountsIcon from 'tdesign-icons-svg/src/wallet.svg?component'
	import EditIcon from 'tdesign-icons-svg/src/edit.svg?component'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'
	let {
		pathname,
		onNavigate,
		accountCreation,
		accounts,
		accountBalances = null,
		selectedAccountIds,
		accountQueries,
		onAccountChange,
		onAllAccountsChange,
		editingAccountOrder,
		canToggleAccountOrder,
		canMoveAccount,
		onEditAccountOrder,
		onDoneAccountOrder,
		onMoveAccount
	}: {
		pathname: string
		onNavigate: () => void
		accountCreation: Snippet<[Snippet<[() => void, boolean]>]>
		accountBalances?: ReadonlyMap<string, bigint> | null
		accounts: readonly Account[]
		selectedAccountIds: readonly string[] | null
		accountQueries: ComponentProps<typeof QueryContent>['queries']
		onAccountChange: (accountId: string, checked: boolean) => void
		onAllAccountsChange: (checked: boolean) => void
		editingAccountOrder: boolean
		canToggleAccountOrder: boolean
		canMoveAccount: (id: string, direction: 'up' | 'down') => boolean
		onEditAccountOrder: () => void
		onDoneAccountOrder: () => void
		onMoveAccount: (id: string, direction: 'up' | 'down') => void
	} = $props()
</script>

{#snippet accountCreationTrigger(open: () => void, disabled: boolean)}
	<Button type="button" {disabled} onclick={open} style="--dui-button-content-icon-size: 1.25rem;">
		<ButtonContent
			icon={AddIcon}
			text={m['actions.add_subject']({ subject: m['nouns.account']({ count: 1 }) })}
		/>
	</Button>
{/snippet}
<li>
	<NavigationGroup label={m['nouns.account']({ count: 2 })} icon={AccountsIcon}>
		<section aria-label={m['nouns.account']({ count: 2 })}>
			<AppDrawerContentSection>
				<QueryContent
					queries={accountQueries}
					loadingMessage={m['status.loading_subject']({
						subject: m['nouns.account']({ count: 2 })
					})}
					errorMessage={m['errors.load_subject']({
						subject: m['nouns.account']({ count: 2 })
					})}
				>
					{#if accounts.length > 0}
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
											checked={selectedAccountIds === null ||
												selectedAccountIds.includes(account.id)}
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
										{#if editingAccountOrder}
											<span class="account-order-controls">
												<Button
													type="button"
													appearance="flat"
													disabled={!canMoveAccount(account.id, 'up')}
													aria-label={m['actions.move_up_name']({ name: account.name })}
													onclick={() => onMoveAccount(account.id, 'up')}
													><Icon icon={ExpensesIcon} style="width: 1rem; height: 1rem;" /></Button
												>
												<Button
													type="button"
													appearance="flat"
													disabled={!canMoveAccount(account.id, 'down')}
													aria-label={m['actions.move_down_name']({ name: account.name })}
													onclick={() => onMoveAccount(account.id, 'down')}
													><Icon icon={IncomeIcon} style="width: 1rem; height: 1rem;" /></Button
												>
											</span>
										{/if}
									</li>
								{/each}
							</ul>
						</fieldset>
						{#if canToggleAccountOrder}
							<Button
								type="button"
								appearance="flat"
								aria-pressed={editingAccountOrder}
								onclick={editingAccountOrder ? onDoneAccountOrder : onEditAccountOrder}
								>{editingAccountOrder
									? m['status.done']()
									: m['actions.edit_subject']({
											subject: m['nouns.order']({ count: 1 })
										})}</Button
							>
						{/if}
					{:else}
						<p>
							{m['labels.no_subjects_yet']({ subjects: m['nouns.account']({ count: 2 }) })}
						</p>
					{/if}
				</QueryContent>

				{@render accountCreation(accountCreationTrigger)}
			</AppDrawerContentSection>
		</section>
		<Navigation label={m['nouns.account']({ count: 2 })}>
			<li>
				<AppNavigationLink
					href="/accounts"
					{pathname}
					icon={EditIcon}
					label={m['actions.manage_subject']({
						subject: m['nouns.account']({ count: 2 })
					})}
					onclick={onNavigate}
				/>
			</li>
		</Navigation>
	</NavigationGroup>
</li>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	p {
		margin: 0;
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
