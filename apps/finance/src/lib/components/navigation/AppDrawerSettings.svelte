<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
	import AppNavigationLink from './AppNavigationLink.svelte'
	import { NavigationGroup, Navigation } from 'delightful-ui'
	import type { ComponentProps } from 'svelte'
	import type { Organization } from '#lib/schema.js'
	import AppDrawerContentSection from './AppDrawerContentSection.svelte'
	import WorkspaceSelector from '../workspaces/WorkspaceSelector.svelte'
	import QueryContent from '../shared/QueryContent.svelte'
	import WorkspaceIcon from 'tdesign-icons-svg/src/building.svg?component'
	import BanksIcon from 'tdesign-icons-svg/src/money.svg?component'
	import AccountIcon from 'tdesign-icons-svg/src/user.svg?component'
	import SettingsIcon from 'tdesign-icons-svg/src/setting.svg?component'
	let {
		pathname,
		onNavigate,
		organizations,
		organizationId,
		organizationQueries,
		onOrganizationChange
	}: {
		pathname: string
		onNavigate: () => void
		organizations: readonly Organization[] | undefined
		organizationId: string | null
		organizationQueries: ComponentProps<typeof QueryContent>['queries']
		onOrganizationChange: (value: string) => void
	} = $props()
</script>

<li>
	<NavigationGroup label={m['navigation.settings']()} icon={SettingsIcon}>
		<AppDrawerContentSection>
			<QueryContent
				queries={organizationQueries}
				loadingMessage={m['status.loading_subject']({
					subject: m['nouns.workspace']({ count: 2 })
				})}
				errorMessage={m['errors.load_subject']({
					subject: m['nouns.workspace']({ count: 2 })
				})}
			>
				<WorkspaceSelector {organizations} {organizationId} onchange={onOrganizationChange} />
			</QueryContent>
		</AppDrawerContentSection>
		<Navigation label={m['navigation.settings']()}>
			<li>
				<AppNavigationLink
					href="/settings/workspace"
					{pathname}
					icon={WorkspaceIcon}
					label={m['nouns.workspace']({ count: 2 })}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href="/settings/banks"
					{pathname}
					icon={BanksIcon}
					label={m['bank.title']()}
					onclick={onNavigate}
				/>
			</li>
			<li>
				<AppNavigationLink
					href="/account"
					{pathname}
					icon={AccountIcon}
					label={m['nouns.account']({ count: 1 })}
					onclick={onNavigate}
				/>
			</li>
		</Navigation>
	</NavigationGroup>
</li>
