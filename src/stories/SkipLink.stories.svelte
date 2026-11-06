<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import { Button, Dialog, SkipButton, SkipLink } from '#lib'

	const { Story } = defineMeta({
		title: 'Accessibility/SkipLink',
		component: SkipLink,
		tags: ['autodocs'],
		args: { href: '#main-content' }
	})
</script>

<script lang="ts">
	let open = $state(false)
</script>

<Story name="Skip to content">
	{#snippet template(args)}
		<SkipLink {...args}>Skip to main content</SkipLink>
		<nav aria-label="Example navigation">
			<a href="#main-content">Overview</a>
		</nav>
		<main id="main-content" tabindex="-1">
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
		<SkipButton disabled>Open tools</SkipButton>
		<Button>Continue</Button>
	{/snippet}
</Story>

<Story name="Open dialog">
	{#snippet template()}
		<SkipButton
			aria-haspopup="dialog"
			aria-controls="example-tools"
			onclick={() => (open = true)}
		>
			Open tools
		</SkipButton>
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
