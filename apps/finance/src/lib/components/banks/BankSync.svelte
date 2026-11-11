<script lang="ts">
	import Icon from '../navigation/AppIcon.svelte'
	import {
		Button,
		ButtonContent,
		Details,
		InputText,
		LoadingSpinner,
		Select,
		Stepper,
		StatusMessage
	} from 'delightful-ui'
	import SearchIcon from 'tdesign-icons-svg/src/search.svg?component'
	import RefreshIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import WifiNoIcon from 'tdesign-icons-svg/src/wifi-no.svg?component'
	import type { ComponentProps } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	import {
		bankSetupSteps,
		type BankPresentation
	} from '#lib/contracts/bank-presentation-contract.js'
	let {
		browserOffline,
		view,
		syncDisabled = false,
		onTestEncryption,
		onVerifyDecryption,
		onSaveConnection,
		onConnect,
		onDiscover,
		onReconnect,
		onSync,
		onMap,
		onCreateAccount,
		onDisconnect,
		onCancel
	}: {
		browserOffline: boolean
		view: BankPresentation
		syncDisabled?: boolean
		onTestEncryption: () => void
		onVerifyDecryption: () => void
		onSaveConnection: () => void
		onConnect: (token: string) => void
		onDiscover: () => void
		onReconnect: () => void
		onSync: () => void
		onMap: (providerId: string, accountId: string) => void
		onCreateAccount: (providerId: string) => void
		onDisconnect: () => void
		onCancel: () => void
	} = $props()
	const status = $derived(view.status)
	const outcome = $derived(view.history)
	const providerAccounts = $derived(view.providerAccounts)
	const busy = $derived(view.activity.kind === 'working')
	const setupStep = $derived(view.mode.kind === 'setup' ? view.mode.step : 0)
	const setupView = $derived(view.mode.kind === 'setup' ? view.mode.stage : null)

	let token = $state('')
	const statusText = $derived(status?.label() ?? '')
	const outcomeText = $derived(
		outcome
			? m['bank.result_time_outcome_imported_existing_omitted']({
					time: outcome.time.toLocaleString(),
					outcome: m[outcome.outcomeKey](),
					imported: outcome.imported,
					existing: outcome.existing,
					omitted: outcome.omitted
				})
			: ''
	)
	const setupSteps = $derived<ComponentProps<typeof Stepper>['steps']>(
		bankSetupSteps.map((step, index) => ({
			...step,
			label: step.label(),
			status: index < setupStep ? 'completed' : index === setupStep ? 'current' : 'upcoming'
		}))
	)
</script>

{#snippet connectionSetup()}
	{#if browserOffline}
		<div class="offline-message" role="status">
			<Icon icon={WifiNoIcon} style="width: 6rem; height: 6rem;" />
			<p>{m['bank.setup_offline']()}</p>
		</div>
	{:else}
		<div class="setup-flow">
			<Stepper
				steps={setupSteps}
				currentStep={setupSteps[setupStep]?.id ?? 'connect'}
				label={m['bank.setup_progress']()}
				completedLabel={m['bank.step_completed']()}
				upcomingLabel={m['bank.step_upcoming']()}
			/>
			<p>{m['bank.passkey_help']()}</p>
			{#if setupView}
				<section aria-live="polite" aria-atomic="true">
					{#if setupView === 'creating'}
						<h2>{m['bank.setup_creating_title']()}</h2>
						<p>{m['bank.setup_creating_body']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{:else if setupView === 'test-encryption'}
						<h2>{m['bank.setup_encrypt_title']()}</h2>
						<p>{m['bank.setup_encrypt_body']()}</p>
						<Button type="button" onclick={onTestEncryption}
							>{m['bank.setup_encrypt_action']()}</Button
						>
					{:else if setupView === 'encrypting'}
						<h2>{m['bank.setup_encrypt_title']()}</h2>
						<p>{m['bank.setup_encrypt_waiting']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{:else if setupView === 'test-decryption'}
						<h2>{m['bank.setup_verify_title']()}</h2>
						<p>{m['bank.setup_verify_body']()}</p>
						<Button type="button" onclick={onVerifyDecryption}
							>{m['bank.setup_verify_action']()}</Button
						>
					{:else if setupView === 'verifying'}
						<h2>{m['bank.setup_verify_title']()}</h2>
						<p>{m['bank.setup_verify_waiting']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{:else if setupView === 'save'}
						<h2>{m['bank.setup_save_title']()}</h2>
						<p>{m['bank.setup_save_body']()}</p>
						<Button type="button" onclick={onSaveConnection}>{m['bank.setup_save_action']()}</Button
						>
					{:else}
						<h2>{m['bank.setup_saving_title']()}</h2>
						<p>{m['bank.setup_saving_body']()}</p>
						<LoadingSpinner role="presentation" aria-hidden="true" />
					{/if}
				</section>
				<Button type="button" onclick={onCancel}>{m['actions.cancel']()}</Button>
			{:else}
				<form
					onsubmit={(event) => {
						event.preventDefault()
						const value = token
						token = ''
						onConnect(value)
					}}
				>
					<div class="token-field">
						<InputText
							label={m['bank.token']()}
							id="simplefin-token"
							autocomplete="off"
							bind:value={token}
							disabled={busy}
						/>
					</div>
					<Button type="submit" disabled={busy || !token.trim()}
						>{m['actions.create_subject']({ subject: m['nouns.passkey']({ count: 1 }) })}</Button
					>
				</form>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="bank-flow">
	<p>{m['bank.manual_only']()}</p>
	{#if status && !(browserOffline && status?.key === 'bank.idle_step')}
		<p role="status" aria-live="polite">{statusText}</p>
	{/if}
	{#if outcomeText}<p>{outcomeText}</p>{/if}
	{#if view.logging?.kind === 'notStarted' || view.logging?.kind === 'resultUnrecorded'}
		<StatusMessage variant="error" text={m['bank.log_result_failed']()} />
	{/if}
	{#if view.activity.kind === 'working' && view.activity.indicator === 'provider'}<LoadingSpinner
			role="presentation"
			aria-hidden="true"
		/>{/if}
	{#if view.mode.kind === 'restricted'}
		<p>{m['bank.restricted']()}</p>
	{:else}
		{#if view.mode.kind === 'setup'}
			{@render connectionSetup()}
		{/if}
		{#if view.mode.kind === 'connected'}
			<Button type="button" onclick={onDiscover} disabled={busy} aria-busy={busy}>
				<ButtonContent
					icon={SearchIcon}
					text={m['actions.discover_subject']({ subject: m['nouns.account']({ count: 2 }) })}
					loading={busy}
				/>
			</Button>

			{#if busy}<Button type="button" onclick={onCancel}>{m['actions.cancel']()}</Button>{/if}
			{#if providerAccounts.some((provider) => provider.mapping.kind === 'unmapped')}
				<Button type="button" onclick={onReconnect} disabled={busy}>
					{m['bank.reconnect_existing_accounts']()}
				</Button>
			{/if}
			<ul>
				{#each providerAccounts as provider (provider.id)}
					<li>
						<p>{provider.name}</p>
						{#if provider.mapping.kind === 'linked'}
							<p>{m['labels.linked_name']({ name: provider.mapping.account.name })}</p>
						{:else if provider.mapping.kind === 'broken'}
							<p>{m['bank.mapping_failure']()}</p>
						{:else}
							<Button type="button" disabled={busy} onclick={() => onCreateAccount(provider.id)}
								>{m['actions.add_subject_name']({
									subject: m['nouns.account']({ count: 1 }),
									name: provider.name
								})}</Button
							>
						{/if}
						{#if provider.showExisting}
							<Select
								label={m['actions.link_existing_subject']({
									subject: m['nouns.account']({ count: 1 })
								})}
								value={provider.selectedAccountId}
								disabled={busy}
								onchange={(event) => {
									if (event.currentTarget.value) onMap(provider.id, event.currentTarget.value)
								}}
							>
								<option value="" disabled
									>{m['actions.select_existing_subject']({
										subject: m['nouns.account']({ count: 1 })
									})}</option
								>
								{#each provider.availableAccounts as account (account.id)}<option value={account.id}
										>{account.name}</option
									>{/each}
							</Select>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if view.mode.kind === 'connected'}
			<div class="connection-actions">
				<Button
					type="button"
					onclick={onSync}
					disabled={browserOffline || busy || syncDisabled}
					aria-busy={busy}
					aria-describedby={browserOffline ? 'bank-sync-offline' : undefined}
				>
					<ButtonContent icon={RefreshIcon} text={m['bank.sync']()} loading={busy} />
				</Button>
				<Button type="button" onclick={onDisconnect} disabled={busy}
					>{m['actions.disconnect_subject']({ subject: m['bank.title']() })}</Button
				>
			</div>
			{#if browserOffline}
				<p id="bank-sync-offline">{m['bank.sync_offline']()}</p>
			{/if}
			{#if view.mode.recovery === 'available'}
				<Details summary={m['bank.lost_passkey']()}>
					<div class="setup-flow">
						<p>{m['bank.recovery']()}</p>
						{@render connectionSetup()}
					</div>
				</Details>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.offline-message {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--dui-space-sm, 1rem);
		text-align: center;
	}

	.bank-flow,
	.setup-flow,
	section {
		display: flex;
		flex-direction: column;
		gap: var(--dui-space-sm, 1rem);
	}

	section {
		align-items: flex-start;
	}

	.connection-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-space-sm, 1rem);
	}

	form {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--dui-space-sm, 1rem);
	}

	.token-field {
		flex: 1 1 16rem;
		min-inline-size: 0;
	}

	h2,
	p,
	ul {
		margin: 0;
	}
</style>
