<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import AccountSelection from '../accounts/AccountSelection.svelte'
	import AppNavigationLink from './AppNavigationLink.svelte'
	import { Button, ButtonContent, NavigationGroup, Navigation } from 'delightful-ui'
	import { type ComponentProps, type Snippet } from 'svelte'
	import type { Account } from '#lib/schema.js'
	import AppDrawerContentSection from './AppDrawerContentSection.svelte'
	import QueryContent from '../shared/QueryContent.svelte'
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
						<AccountSelection
							{accounts}
							{accountBalances}
							{selectedAccountIds}
							{onAccountChange}
							{onAllAccountsChange}
							ordering={{
								editing: editingAccountOrder,
								canToggle: canToggleAccountOrder,
								canMove: canMoveAccount,
								onMove: onMoveAccount,
								onEdit: onEditAccountOrder,
								onDone: onDoneAccountOrder
							}}
						/>
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
	p {
		margin: 0;
	}
</style>
