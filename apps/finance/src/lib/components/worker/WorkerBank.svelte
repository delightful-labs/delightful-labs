<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { beforeNavigate } from '$app/navigation'
	import { getFinanceWorker } from '../../runtime/worker/context.js'
	import type { WorkerBankCommand } from '../../contracts/worker-banks.js'
	import BankSync from '../banks/BankSync.svelte'
	import BankSyncLog from '../banks/BankSyncLog.svelte'
	import { StatusMessage } from 'delightful-ui'
	import { m } from '../../paraglide/messages.js'
	const { client } = getFinanceWorker()
	const state = fromStore(client.view)
	const bank = $derived(state.current.bank)
	function send(command: WorkerBankCommand) {
		client.bankCommand(command, state.current)
	}
	beforeNavigate((navigation) => {
		// A manual sync belongs to the SDK session; other interactive bank steps cancel on navigation.
		if (navigation.willUnload || !bank?.continueOnNavigation) send({ type: 'CANCEL' })
	})
</script>

{#if bank}
	{#key `${state.current.sessionRevision}:${state.current.selection.workspaceId}`}
		<BankSync
			browserOffline={bank.offline}
			view={bank.view}
			syncDisabled={!bank.canSync}
			onTestEncryption={() => send({ type: 'TEST_ENCRYPTION' })}
			onVerifyDecryption={() => send({ type: 'VERIFY_DECRYPTION' })}
			onSaveConnection={() => send({ type: 'SAVE_CONNECTION' })}
			onConnect={(token) => client.connectBank(token, state.current)}
			onDiscover={() => send({ type: 'DISCOVER' })}
			onReconnect={() => send({ type: 'RECONNECT' })}
			onSync={() => send({ type: 'SYNC' })}
			onMap={(providerId, accountId) => send({ type: 'MAP', providerId, accountId })}
			onCreateAccount={(providerId) => send({ type: 'CREATE_ACCOUNT', providerId })}
			onDisconnect={() => send({ type: 'DISCONNECT' })}
			onCancel={() => send({ type: 'CANCEL' })}
		/>
		{#if bank.history}
			<BankSyncLog
				connections={bank.history.connections}
				connectionId={bank.history.connectionId}
				attempts={bank.history.attempts}
				accounts={bank.history.accounts}
				profiles={bank.history.profiles}
				hasEarlier={bank.history.hasEarlier}
				onConnection={(connectionId) =>
					client.bankHistoryCommand({ type: 'SELECT', connectionId }, state.current)}
				onEarlier={() => client.bankHistoryCommand({ type: 'EARLIER' }, state.current)}
			/>
			{#if bank.history.failed}<StatusMessage
					variant="error"
					text={m['errors.load_subject']({ subject: m['bank.log_title']() })}
				/>{/if}
		{/if}
	{/key}
{:else}
	<StatusMessage
		variant={state.current.status === 'failed' ? 'error' : 'loading'}
		text={state.current.status === 'failed' ? m['forms.load_failed']() : m['status.loading']()}
	/>
{/if}
