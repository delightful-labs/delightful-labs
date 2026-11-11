<script lang="ts">
	import { Button, ButtonContent, StatusMessage } from 'delightful-ui'
	import type { BankSyncControls } from '#lib/runtime/bank-sync.js'
	import { m } from '#lib/paraglide/messages.js'
	import SyncIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import AppDrawerContentSection from './AppDrawerContentSection.svelte'
	import PwaUpdateIntegration from '../pwa/PwaUpdateIntegration.svelte'
	let {
		bankSync,
		browserOffline,
		syncConfigured
	}: {
		bankSync: BankSyncControls
		syncConfigured: boolean
		browserOffline: boolean
	} = $props()
</script>

<AppDrawerContentSection>
	{#if bankSync.visible}
		<Button
			disabled={browserOffline || bankSync.disabled}
			aria-busy={bankSync.loading}
			aria-describedby={browserOffline ? 'sidebar-bank-sync-offline' : undefined}
			onclick={() => bankSync.sync()}
		>
			<ButtonContent icon={SyncIcon} text={m['bank.sync']()} loading={bankSync.loading} />
		</Button>
		{#if browserOffline}
			<p id="sidebar-bank-sync-offline">{m['bank.sync_offline']()}</p>
		{/if}
	{/if}

	<div class="sidebar-status">
		<PwaUpdateIntegration />
		<StatusMessage
			compact
			text={!syncConfigured
				? m['database.online']()
				: browserOffline
					? m['database.offline']()
					: m['database.online']()}
		/>
	</div>
</AppDrawerContentSection>

<style>
	.sidebar-status {
		margin-block-start: auto;
	}
	p {
		margin: 0;
	}
</style>
