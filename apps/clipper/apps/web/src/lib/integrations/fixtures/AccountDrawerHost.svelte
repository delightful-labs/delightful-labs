<script lang="ts">
	import AccountDrawer from '../AccountDrawer.svelte'
	import { setAccountSettings } from '../../runtime/account-settings.js'
	let drawer: ReturnType<typeof AccountDrawer> | undefined = $state()
	const control = $derived(drawer?.getControl())
	setAccountSettings({
		get controls() {
			return controls
		},
		accountMessage: undefined,
		connectionMessage: { text: 'Connected fixture', variant: 'info' }
	})
</script>

{#snippet controls()}<span>Account fixture</span>{/snippet}
{@render control?.()}
<AccountDrawer bind:this={drawer} />
<section aria-label="Page fixture" inert={drawer?.isModal() ?? false}>Page content</section>
