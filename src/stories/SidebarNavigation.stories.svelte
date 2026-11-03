<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import {
		Drawer,
		Navigation,
		NavigationLink,
		NavigationGroup,
		DrawerSection,
		Checkbox,
		StatusMessage
	} from '#lib'
	import InboxIcon from 'tdesign-icons-svg/src/dashboard.svg?component'
	import SettingsIcon from 'tdesign-icons-svg/src/setting.svg?component'

	const { Story } = defineMeta({
		title: 'Layout/Sidebar navigation',
		component: NavigationLink,
		tags: ['autodocs'],
		parameters: {
			docs: {
				description: {
					component:
						'Compose native links and disclosures inside Navigation list items. Consumers supply resolved URLs, aria-current, translated labels, and callbacks. DrawerSection accepts arbitrary controls; label section elements with aria-label or aria-labelledby.'
				}
			}
		}
	})
</script>

<Story name="Drawer composition">
	{#snippet template()}
		<Drawer
			open
			heading="Library navigation"
			closeLabel="Close navigation"
			showCloseButton={false}
			style="--dui-drawer-height: 32rem; --dui-drawer-padding: 0; --dui-navigation-gap: 0;"
		>
			<Navigation label="Library">
				<li>
					<NavigationLink href="#inbox" icon={InboxIcon} aria-current="page">
						Inbox
						{#snippet trailing()}12{/snippet}
					</NavigationLink>
				</li>
				<li><NavigationLink href="#later">Later</NavigationLink></li>
				<li><NavigationLink href="#archive">Archive</NavigationLink></li>
				<li>
					<NavigationGroup label="Settings" icon={SettingsIcon} open>
						<DrawerSection element="section" aria-label="Display preferences">
							<Checkbox label="Show reading progress" />
						</DrawerSection>
						<Navigation label="Settings">
							<li>
								<NavigationLink href="#appearance"
									>Appearance and reading preferences</NavigationLink
								>
							</li>
							<li><NavigationLink href="#account">Account</NavigationLink></li>
						</Navigation>
					</NavigationGroup>
				</li>
			</Navigation>
			<DrawerSection
				><StatusMessage text="Example status" compact /></DrawerSection
			>
		</Drawer>
	{/snippet}
</Story>
