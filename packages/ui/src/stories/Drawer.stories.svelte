<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Drawer from '#lib/Components/Drawer.svelte'
	import Navigation from '#lib/Components/Navigation.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Layout/Drawer',
		component: Drawer,
		tags: ['autodocs'],
		args: { heading: 'Main menu', closeLabel: 'Close menu' },
		argTypes: {
			open: { control: false },
			side: { control: 'select', options: ['left', 'right'] },
			headingHidden: { control: 'boolean' }
		}
	})
</script>

<script lang="ts">
	const generatedId = $props.id()
	const sidebarId = `${generatedId}-sidebar`
	let open = $state(false)
</script>

<Story name="Inline sidebar" args={{ style: '--dui-drawer-width: 18rem;' }}>
	{#snippet template(args)}
		<div class="inline-example">
			<Button
				aria-controls={sidebarId}
				aria-expanded={open}
				onclick={() => (open = !open)}
			>
				Toggle sidebar
			</Button>
			<div class="inline-layout">
				<Drawer {...args} id={sidebarId} bind:open>
					<Navigation label="Main navigation">
						<li><a href="#overview" aria-current="page">Overview</a></li>
						<li><a href="#accounts">Accounts</a></li>
						<li><a href="#settings">Settings</a></li>
					</Navigation>
				</Drawer>
				<section class="example-content" aria-label="Page content">
					<h2>Page content</h2>
					<p>
						The sidebar reserves layout space while this content remains
						interactive.
					</p>
					<label for={`${generatedId}-notes`}>Notes</label>
					<textarea id={`${generatedId}-notes`} rows={4}></textarea>
					<a href="#continue">Continue working</a>
				</section>
			</div>
		</div>
	{/snippet}
</Story>

<Story
	name="Inline right sidebar"
	args={{ side: 'right', style: '--dui-drawer-width: 18rem;' }}
>
	{#snippet template(args)}
		<div class="inline-example">
			<Button
				aria-controls={sidebarId}
				aria-expanded={open}
				onclick={() => (open = !open)}
			>
				Toggle sidebar
			</Button>
			<div class="inline-layout">
				<section class="example-content" aria-label="Page content">
					<h2>Page content</h2>
					<p>
						The sidebar follows the content in both visual and reading order.
					</p>
					<a href="#continue">Continue working</a>
				</section>
				<Drawer {...args} id={sidebarId} bind:open>
					<Navigation label="Main navigation">
						<li><a href="#accounts">Accounts</a></li>
						<li><a href="#settings">Settings</a></li>
					</Navigation>
				</Drawer>
			</div>
		</div>
	{/snippet}
</Story>

<Story
	name="Compact navigation"
	args={{
		headingHidden: true,
		heading: 'Main navigation',
		style: '--dui-drawer-width: 18rem;'
	}}
>
	{#snippet template(args)}
		<Button onclick={() => (open = true)}>Open navigation</Button>
		<Drawer {...args} bind:open>
			<Navigation label="Main navigation">
				<li><a href="#overview" onclick={() => (open = false)}>Overview</a></li>
				<li><a href="#accounts" onclick={() => (open = false)}>Accounts</a></li>
			</Navigation>
		</Drawer>
	{/snippet}
</Story>

<style>
	.inline-example,
	.example-content {
		display: grid;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}
	.inline-example {
		justify-items: start;
		inline-size: 100%;
	}
	.inline-layout {
		display: flex;
		align-items: stretch;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
		inline-size: 100%;
	}
	.example-content {
		flex: 1;
		min-inline-size: 0;
		align-content: start;
	}
	h2,
	p {
		margin: 0;
	}
	textarea {
		max-inline-size: 100%;
		box-sizing: border-box;
	}
	@media (max-width: 40rem) {
		.inline-layout {
			flex-direction: column;
		}
	}
</style>
