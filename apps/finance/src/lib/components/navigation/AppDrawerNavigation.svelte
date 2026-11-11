<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import Icon from './AppIcon.svelte'
	import AppNavigationLink from './AppNavigationLink.svelte'
	import type { Snippet } from 'svelte'
	import { Navigation } from 'delightful-ui'
	import { INCOME_PATH, EXPENSES_PATH } from '#lib/domain/transaction-kind.js'
	import OverviewIcon from 'tdesign-icons-svg/src/dashboard.svg?component'
	import ExpensesIcon from 'tdesign-icons-svg/src/arrow-up.svg?component'
	import IncomeIcon from 'tdesign-icons-svg/src/arrow-down.svg?component'
	import TransfersIcon from 'tdesign-icons-svg/src/swap.svg?component'
	import CategoriesIcon from 'tdesign-icons-svg/src/root-list.svg?component'
	import TagsIcon from 'tdesign-icons-svg/src/tag.svg?component'
	import LoginIcon from 'tdesign-icons-svg/src/login.svg?component'

	let {
		pathname,
		onNavigate,
		children
	}: {
		pathname: string
		onNavigate: () => void
		children: Snippet
	} = $props()
</script>

<Navigation label={m['navigation.label']()}>
	<li>
		<AppNavigationLink
			href="/"
			{pathname}
			icon={OverviewIcon}
			label={m['navigation.overview']()}
			onclick={onNavigate}
		/>
	</li>
	<li>
		<AppNavigationLink
			href={EXPENSES_PATH}
			{pathname}
			icon={ExpensesIcon}
			label={m['nouns.expense']({ count: 2 })}
			onclick={onNavigate}
		/>
	</li>
	<li>
		<AppNavigationLink
			href={INCOME_PATH}
			{pathname}
			icon={IncomeIcon}
			label={m['nouns.income']({ count: 1 })}
			onclick={onNavigate}
		/>
	</li>

	<li>
		<AppNavigationLink
			href="/transfers"
			{pathname}
			icon={TransfersIcon}
			label={m['nouns.transfer']({ count: 2 })}
			onclick={onNavigate}
		/>
	</li>

	<li>
		<AppNavigationLink
			href="/settings/categories"
			{pathname}
			icon={CategoriesIcon}
			label={m['nouns.category']({ count: 2 })}
			onclick={onNavigate}
		/>
	</li>
	<li>
		<AppNavigationLink
			href="/settings/tags"
			{pathname}
			icon={TagsIcon}
			label={m['nouns.tag']({ count: 2 })}
			onclick={onNavigate}
		/>
	</li>
	{@render children()}
	<li>
		<AppNavigationLink
			href="/login"
			{pathname}
			icon={LoginIcon}
			label={m['navigation.login']()}
			onclick={onNavigate}
		/>
	</li>
</Navigation>
