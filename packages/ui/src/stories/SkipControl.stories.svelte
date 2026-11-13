<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import { Button, Dialog, SkipControl } from '#lib'

	const { Story } = defineMeta({
		title: 'Accessibility/SkipControl',
		component: SkipControl,
		tags: ['autodocs'],
		args: { href: '#main-content' }
	})
</script>

<script lang="ts">
	let open = $state(false)
</script>

<Story name="Skip to content">
	{#snippet template(args)}
		<SkipControl {...args}>Skip to main content</SkipControl>
		<nav aria-label="Example navigation">
			<a href="#main-content">Overview</a>
		</nav>
		<main id="main-content">
			<h1>Main content</h1>
			<p>
				Press Tab to reveal the skip link, then Enter to focus this content.
			</p>
			<a href="#next-section">Continue reading</a>
		</main>
		<section id="next-section">
			<h2>Next section</h2>
		</section>
	{/snippet}
</Story>

<Story name="Disabled action">
	{#snippet template()}
		<SkipControl component={Button} disabled>Open tools</SkipControl>
		<Button>Continue</Button>
	{/snippet}
</Story>

<Story name="Open dialog">
	{#snippet template()}
		<SkipControl
			component={Button}
			aria-haspopup="dialog"
			aria-controls="example-tools"
			onclick={() => (open = true)}
		>
			Open tools
		</SkipControl>
		<p>
			Press Tab to reveal the tools button. Enter or Space opens the dialog.
		</p>
		<Button>Continue</Button>
		<Dialog id="example-tools" heading="Tools" bind:open closedby="any">
			<p>The application owns this dialog and its contents.</p>
			<Button onclick={() => (open = false)}>Close</Button>
		</Dialog>
	{/snippet}
</Story>
