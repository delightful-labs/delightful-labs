<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Navigation from '#lib/Components/Navigation.svelte'
	import Popover from '#lib/Components/Popover.svelte'

	const { Story } = defineMeta({
		title: 'Layout/Navigation',
		component: Navigation,
		tags: ['autodocs'],
		args: { label: 'Main navigation' },
		argTypes: {
			orientation: { control: 'select', options: ['vertical', 'horizontal'] }
		}
	})
</script>

<script lang="ts">
	const generatedId = $props.id()
	const dropdownId = `${generatedId}-settings`
	let dropdownOpen = $state(false)
	function closeDropdown() {
		const panel = document.getElementById(dropdownId)
		if (panel instanceof HTMLElement) panel.hidePopover()
	}
</script>

<Story name="Sidebar">
	{#snippet template(args)}
		<Navigation {...args}>
			<li><a href="#overview" aria-current="page">Overview</a></li>
			<li><a href="#expenses">Expenses</a></li>
			<li><a href="#income">Income</a></li>
			<li><a href="#accounts">Accounts</a></li>
			<li><a href="#workspace">Workspace</a></li>
		</Navigation>
	{/snippet}
</Story>
<Story name="Horizontal" args={{ orientation: 'horizontal' }}>
	{#snippet template(args)}
		<Navigation {...args}>
			<li><a href="#overview" aria-current="page">Overview</a></li>
			<li><a href="#expenses">Expenses</a></li>
			<li><a href="#income">Income</a></li>
			<li><a href="#accounts">Accounts</a></li>
		</Navigation>
	{/snippet}
</Story>
<Story name="With dropdown" args={{ orientation: 'horizontal' }}>
	{#snippet template(args)}
		<Navigation {...args}>
			<li><a href="#overview" aria-current="page">Overview</a></li>
			<li><a href="#accounts">Accounts</a></li>
			<li>
				<button
					type="button"
					popovertarget={dropdownId}
					aria-controls={dropdownId}
					aria-expanded={dropdownOpen}
				>
					<span aria-hidden="true">{dropdownOpen ? '▾' : '▸'}</span>
					<span>Settings</span>
				</button>
				<Popover
					id={dropdownId}
					style="--dui-popover-width: max-content;"
					ontoggle={(event) =>
						(dropdownOpen = event.currentTarget.matches(':popover-open'))}
				>
					<ul class="dropdown-links">
						<li><a href="#workspace" onclick={closeDropdown}>Workspace</a></li>
						<li>
							<a href="#categories" onclick={closeDropdown}>Categories</a>
						</li>
						<li>
							<a href="#recovery" onclick={closeDropdown}>Account recovery</a>
						</li>
					</ul>
				</Popover>
			</li>
			<li><a href="#help">Help</a></li>
		</Navigation>
	{/snippet}
</Story>
<Story name="Horizontal wrapping" args={{ orientation: 'horizontal' }}>
	{#snippet template(args)}
		<div style="max-inline-size: 14rem;">
			<Navigation {...args}>
				<li><a href="#overview" aria-current="page">Overview</a></li>
				<li><a href="#expenses">Expenses</a></li>
				<li><a href="#income">Income</a></li>
				<li><a href="#accounts">Accounts</a></li>
			</Navigation>
		</div>
	{/snippet}
</Story>
<Story name="Multiple landmarks">
	{#snippet template()}
		<div class="groups">
			<Navigation label="Finance">
				<li><a href="#overview" aria-current="page">Overview</a></li>
				<li><a href="#accounts">Accounts</a></li>
			</Navigation>
			<Navigation label="Settings">
				<li><a href="#workspace">Workspace</a></li>
				<li><a href="#recovery">Account recovery</a></li>
			</Navigation>
		</div>
	{/snippet}
</Story>
<Story name="Long labels">
	{#snippet template(args)}
		<div style="max-inline-size: 14rem;">
			<Navigation {...args}>
				<li>
					<a href="#accounts" aria-current="page"
						>Accounts and transaction history</a
					>
				</li>
				<li><a href="#settings">Workspace settings and account recovery</a></li>
			</Navigation>
		</div>
	{/snippet}
</Story>

<style>
	.dropdown-links {
		display: grid;
		gap: var(
			--dui-navigation-gap,
			var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem))
		);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.groups {
		display: grid;
		gap: var(--dui-space-lg, var(--dui-spacing-xl, 2rem));
	}
</style>
