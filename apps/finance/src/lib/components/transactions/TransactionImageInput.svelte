<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte'
	import { stopAfterShutdown } from '#lib/runtime/actor-lifecycle.js'
	import { createActor } from 'xstate'
	import { Button, Dialog, InputImages, StatusMessage } from 'delightful-ui'
	import {
		transactionImageSelectionMachine,
		transactionImageSelectionPresentation
	} from '#lib/machines/transactions/attachments/transaction-image-selection.js'
	import { m } from '#lib/paraglide/messages.js'
	import ImageEditor from '../image-editor/ImageEditor.svelte'

	let {
		id = 'transaction-attachments',
		disabled = false,
		invalid,
		describedby,
		savedImages,
		onfileschange
	}: {
		id?: string
		disabled?: boolean
		invalid?: boolean | undefined
		describedby?: string | undefined
		savedImages?: Snippet | undefined
		onfileschange?: ((files: readonly File[]) => void) | undefined
	} = $props()
	const actor = untrack(() =>
		createActor(transactionImageSelectionMachine, { input: { editable: !disabled } })
	)
	let selection = $state.raw(transactionImageSelectionPresentation(actor.getSnapshot()))

	function send(event: Parameters<typeof actor.send>[0]) {
		if (actor.getSnapshot().status === 'active') actor.send(event)
	}
	$effect(() => {
		send({ type: 'SET_EDITABLE', editable: !disabled })
	})
	onMount(() => {
		let published = actor.getSnapshot().context.files
		const subscription = actor.subscribe((snapshot) => {
			selection = transactionImageSelectionPresentation(snapshot)
			if (snapshot.context.files === published) return
			published = snapshot.context.files
			onfileschange?.(published)
			const element = document.getElementById(id)
			void tick().then(() => {
				if (element?.isConnected && element instanceof HTMLInputElement)
					element.form?.dispatchEvent(new Event('input', { bubbles: true }))
			})
		})
		actor.start()
		return () => {
			subscription.unsubscribe()
			stopAfterShutdown(actor)
		}
	})
</script>

<InputImages
	label={m['actions.add_subject']({ subject: m['nouns.image']({ count: 2 }) })}
	uploadLabel={m['actions.select_subject']({ subject: m['nouns.image']({ count: 2 }) })}
	infoLabel={m['labels.subject_details']({ subject: m['nouns.image']({ count: 1 }) })}
	closeLabel={m['actions.close']()}
	removeLabel={m['actions.remove_subject']({ subject: m['nouns.image']({ count: 1 }) })}
	{id}
	name="attachments"
	accept="image/jpeg,image/png,image/webp"
	bind:value={() => selection.files, (files) => send({ type: 'SELECT', files })}
	disabled={!selection.canSelect}
	aria-invalid={invalid || undefined}
	aria-describedby={describedby}
>
	{#snippet leadingImages()}
		{#if savedImages}{@render savedImages()}{/if}
	{/snippet}
	{#snippet imageActions(file, closePreview)}
		<Button
			type="button"
			disabled={!selection.editableFiles.includes(file)}
			onclick={() => {
				closePreview()
				send({ type: 'EDIT', file })
			}}>{m['actions.edit_subject']({ subject: m['nouns.image']({ count: 1 }) })}</Button
		>
	{/snippet}
</InputImages>
{#if selection.error}
	<StatusMessage
		variant="error"
		text={selection.error === 'editingFailed'
			? m['images.edit_failed']()
			: m['forms.validation_error']()}
	/>
{/if}
{#if selection.editor}
	<Dialog
		heading={m['actions.edit_subject']({ subject: m['nouns.image']({ count: 1 }) })}
		open
		closedby="any"
		onclose={() => send({ type: 'CLOSE' })}
		oninput={(event) => event.stopPropagation()}
	>
		<ImageEditor file={selection.editor.file} actor={selection.editor.actor} />
	</Dialog>
{/if}
