<script lang="ts">
	import { Button, Dialog, StatusMessage } from 'delightful-ui'
	import type { InternalTransferDeleteChoice } from '#lib/machines/transfers/internal-transfer.js'
	import type { TransferDeleteFeedback } from '#lib/machines/transactions/transaction-edit.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		transactionId,
		available,
		pending,
		feedback,
		onDelete
	}: {
		transactionId: string
		available: boolean
		pending: boolean
		feedback: TransferDeleteFeedback | null
		onDelete: (choice: InternalTransferDeleteChoice) => void
	} = $props()
	let open = $state(false)
	function choose(choice: InternalTransferDeleteChoice) {
		open = false
		onDelete(choice)
	}
</script>

{#if available}
	<Button type="button" disabled={pending} onclick={() => (open = true)}>
		{m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	</Button>
{/if}

{#if feedback}
	<StatusMessage variant={feedback.variant} text={feedback.label()} />
{/if}

<Dialog
	heading={m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	bind:open
	closedby="any"
>
	<p>{m['transfers.delete_effect_both']()}</p>
	<Button type="button" onclick={() => choose({ kind: 'both' })}>
		{m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 2 }) })}
	</Button>
	<p>{m['transfers.delete_effect_selected']()}</p>
	<Button type="button" onclick={() => choose({ kind: 'selected', transactionId })}>
		{m['actions.delete_subject']({ subject: m['nouns.transaction']({ count: 1 }) })}
	</Button>
	<Button type="button" onclick={() => (open = false)}>{m['actions.cancel']()}</Button>
</Dialog>
