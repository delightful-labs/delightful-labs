<script lang="ts">
	import { untrack, type Snippet } from 'svelte'
	import { Button, Dialog, InputText, ScreenReaderText } from 'delightful-ui'
	import type {
		WorkspaceCreationDialogMessages,
		WorkspaceCreationDialogView
	} from '../../contracts/workspace-creation-dialog.js'

	let {
		scope,
		view,
		messages,
		onSubmit,
		onRetry,
		onNew,
		completion
	}: {
		scope: unknown
		view: WorkspaceCreationDialogView
		messages: WorkspaceCreationDialogMessages
		onSubmit: (name: string) => void
		onRetry: () => void
		onNew: () => void
		/** Consumer-owned links/actions; the library does not compose routes. */
		completion?: Snippet
	} = $props()

	const instanceId = $props.id()
	const nameId = `${instanceId}-name`
	const draftRevision = $derived(view.draftRevision)
	let open = $state(false)
	let name = $state('')
	let feedback = $state<HTMLDivElement>()
	let form = $state<HTMLFormElement>()
	let trigger = $state<HTMLButtonElement>()

	$effect(() => {
		void scope
		open = false
		name = ''
	})
	$effect(() => {
		void draftRevision
		name = ''
	})
	$effect(() => {
		if (!view.canOpen) open = false
	})
	$effect(() => {
		if (open && (view.content === 'complete' || view.feedback.priority === 'alert')) {
			untrack(() => feedback?.focus())
		} else if (open && view.fieldsEditable) {
			untrack(() => form?.querySelector('input')?.focus())
		}
	})

	function focusContent() {
		if (view.content === 'complete' || view.feedback.priority === 'alert') feedback?.focus()
		else if (view.fieldsEditable) form?.querySelector('input')?.focus()
	}

	function show(event: MouseEvent & { currentTarget: HTMLButtonElement }) {
		if (!view.canOpen) return
		trigger = event.currentTarget
		if (view.canCreateAnother) onNew()
		open = true
	}
</script>

<Button type="button" disabled={!view.canOpen} onclick={show}>{messages.heading}</Button>

<Dialog
	heading={messages.heading}
	bind:open
	closedby="any"
	ontoggle={(event) => {
		if (event.newState === 'open') focusContent()
	}}
	onclose={(event) => {
		if (!event.currentTarget.open) trigger?.focus()
	}}
>
	<ScreenReaderText role="status">
		{view.feedback.priority === 'status' ? view.feedback.text : ''}
	</ScreenReaderText>
	<ScreenReaderText role="alert">
		{view.feedback.priority === 'alert' ? view.feedback.text : ''}
	</ScreenReaderText>
	<form
		bind:this={form}
		aria-busy={view.activity === 'working'}
		onsubmit={(event) => {
			event.preventDefault()
			if (view.canSubmit) onSubmit(name)
		}}
		onreset={(event) => event.preventDefault()}
	>
		{#if view.content === 'fields'}
			<InputText
				id={nameId}
				label={messages.nameLabel}
				name="name"
				bind:value={name}
				required
				disabled={!view.fieldsEditable}
			/>
		{/if}
		<div bind:this={feedback} tabindex="-1" class="feedback">
			{#if view.feedback.text && view.feedback.visible !== false}
				<p>{view.feedback.text}</p>
			{/if}
			{#if view.attemptName && view.content !== 'complete'}<p>{view.attemptName}</p>{/if}
			{#if view.canRetry}<Button type="button" onclick={onRetry}>{messages.retry}</Button>{/if}
			{#if view.content === 'complete'}{@render completion?.()}{/if}
			{#if view.canCreateAnother}
				<Button type="button" onclick={onNew}>{messages.createAnother}</Button>
			{/if}
		</div>
		<div class="controls">
			<Button type="button" onclick={() => (open = false)}>
				{view.content === 'complete' || view.activity === 'working' ? messages.close : messages.cancel}
			</Button>
			{#if view.content === 'fields'}
				<Button type="submit" variant="primary" disabled={!view.canSubmit}>
					{messages.submit}
				</Button>
			{/if}
		</div>
	</form>
</Dialog>

<style>
	form,
	.feedback {
		display: grid;
		gap: var(--dui-space-sm, 1rem);
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-xs, 0.5rem);
	}
</style>
