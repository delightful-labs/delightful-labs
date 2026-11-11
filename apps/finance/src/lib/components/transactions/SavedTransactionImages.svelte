<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { stopAfterShutdown } from '#lib/runtime/actor-lifecycle.js'
	import { createActor } from 'xstate'
	import { Button, Dialog, StatusMessage } from 'delightful-ui'
	import type { getDb } from 'jazz-tools/svelte'
	import {
		savedTransactionImageEditorMachine,
		savedImageEditorPresentation
	} from '#lib/machines/transactions/attachments/saved-transaction-image-editor.js'
	import type { AttachmentReplacementInput } from '#lib/machines/transactions/attachments/transaction-attachment-replacement.js'
	import { m } from '#lib/paraglide/messages.js'
	import TransactionAttachments, { type AttachmentImage } from './TransactionAttachments.svelte'
	import ImageEditor from '../image-editor/ImageEditor.svelte'

	let {
		db,
		transaction,
		images,
		canEdit,
		removingIds,
		failedIds,
		onremove
	}: {
		db: Pick<ReturnType<typeof getDb>, 'one' | 'beginTransaction'>
		transaction: AttachmentReplacementInput['transaction']
		images: readonly AttachmentImage[]
		canEdit: boolean
		removingIds: readonly string[]
		failedIds: readonly string[]
		onremove: (id: string) => void
	} = $props()
	const actor = untrack(() =>
		createActor(savedTransactionImageEditorMachine, {
			input: {
				db,
				transaction,
				observation: { editable: canEdit, images, blockedIds: removingIds }
			}
		})
	)
	let view = $state.raw(savedImageEditorPresentation(actor.getSnapshot()))

	function send(event: Parameters<typeof actor.send>[0]) {
		if (actor.getSnapshot().status === 'active') actor.send(event)
	}
	$effect(() => {
		send({ type: 'OBSERVE', observation: { editable: canEdit, images, blockedIds: removingIds } })
	})
	onMount(() => {
		const subscription = actor.subscribe({
			next: (snapshot) => {
				view = savedImageEditorPresentation(snapshot)
			}
		})
		actor.start()
		return () => {
			subscription.unsubscribe()
			stopAfterShutdown(actor)
		}
	})
</script>

<TransactionAttachments
	{images}
	{canEdit}
	{failedIds}
	{onremove}
	removingIds={view.disabledIds}
	editableIds={view.editableIds}
	onedit={(attachmentId) => send({ type: 'EDIT', attachmentId })}
/>
{#if view.problem}<StatusMessage variant="error" text={m['images.edit_failed']()} />{/if}
{#if view.dialog}
	<Dialog
		heading={m['actions.edit_subject']({ subject: m['nouns.image']({ count: 1 }) })}
		open
		closedby="any"
		onclose={() => send({ type: 'CLOSE' })}
		oninput={(event) => event.stopPropagation()}
	>
		{#if view.dialog.kind === 'editor'}
			<ImageEditor file={view.dialog.file} actor={view.dialog.actor} />
		{:else}
			<StatusMessage
				variant="loading"
				text={view.dialog.kind === 'loading'
					? m['status.loading_subject']({ subject: m['nouns.image']({ count: 1 }) })
					: m['forms.settling']()}
			/>
			<Button type="button" onclick={() => send({ type: 'CLOSE' })}>{m['actions.close']()}</Button>
		{/if}
	</Dialog>
{/if}
