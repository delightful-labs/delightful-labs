<script lang="ts">
	import AccountDrawer from '../../lib/integrations/AccountDrawer.svelte'
	import { Heading } from 'delightful-ui'
	import { getAccountSettings } from '../../lib/runtime/account-settings.js'
	import { noun } from '../../lib/localization/index.js'
	const settings = getAccountSettings()
	let accountDrawer: ReturnType<typeof AccountDrawer> | undefined = $state()
	const accountControl = $derived(accountDrawer?.getControl())
</script>

{@render accountControl?.()}
<div class="page-workspace">
	<AccountDrawer bind:this={accountDrawer} />
	<div class="page-content" inert={accountDrawer?.isModal() ?? false}>
		<section aria-label={noun('account')}>
			<div class="account-heading">
				<Heading level="h1" size="xxl">{noun('account')}</Heading>
			</div>
			<div class="account-settings">{@render settings.controls()}</div>
		</section>
	</div>
</div>

<style>
	.page-workspace {
		position: relative;
		display: flex;
		min-inline-size: 0;
	}
	.page-content {
		flex: 1 1 0%;
		min-inline-size: 0;
	}
	@media (max-width: 48rem) {
		.page-workspace {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}
		.page-content {
			grid-area: 1 / 1;
		}
	}

	.account-heading {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
	}

	.account-settings {
		max-inline-size: 40rem;
	}
</style>
