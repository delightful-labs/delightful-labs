<script lang="ts">
	import { onDestroy } from 'svelte'
	import { Button, Dialog, StatusMessage, Textarea } from 'delightful-ui'
	import type { RecoveryPhraseView } from '../../contracts/recovery-phrase.js'
	import type { RecoveryMessages } from '../../contracts/recovery-messages.js'

	let {
		view,
		messages,
		onReveal,
		onRetry,
		onHide
	}: {
		view: RecoveryPhraseView
		messages: RecoveryMessages
		onReveal: () => void
		onRetry: () => void
		onHide: () => void
	} = $props()

	const instanceId = $props.id()
	const warningId = `${instanceId}-warning`
	const phraseId = `${instanceId}-phrase`
	let warning = $state<HTMLParagraphElement>()
	let returnFocusTarget: HTMLButtonElement | undefined
	const feedback = $derived(
		view.kind === 'revealing'
			? messages.pending
			: view.kind === 'failed'
				? messages.failure
				: view.kind === 'unavailable'
					? messages.unavailable
					: ''
	)

	onDestroy(() => {
		if (view.kind === 'revealed' || view.kind === 'revealing') onHide()
	})
</script>

<p>{messages.description}</p>

<Button
	type="button"
	disabled={view.kind === 'unavailable' || view.kind === 'revealing' || view.kind === 'closed'}
	onclick={(event) => {
		returnFocusTarget = event.currentTarget
		if (view.kind === 'failed') onRetry()
		else onReveal()
	}}
>
	{view.kind === 'failed' ? messages.retry : messages.show}
</Button>

<StatusMessage
	hidden={feedback.length === 0}
	variant={view.kind === 'failed' ? 'error' : view.kind === 'revealing' ? 'loading' : 'info'}
	text={feedback}
/>

<Dialog
	heading={messages.heading}
	aria-describedby={view.kind === 'revealed' ? warningId : undefined}
	open={view.kind === 'revealed'}
	closedby="any"
	oncancel={onHide}
	onbeforetoggle={(event) => {
		if (event.newState === 'closed' && view.kind === 'revealed') onHide()
	}}
	onclose={(event) => {
		if (event.currentTarget.open) return
		if (view.kind === 'revealed') onHide()
		if (returnFocusTarget?.isConnected) returnFocusTarget.focus()
		returnFocusTarget = undefined
	}}
	ontoggle={(event) => {
		if (event.newState === 'open' && view.kind === 'revealed') warning?.focus()
	}}
>
	{#if view.kind === 'revealed'}
		<div class="recovery-content">
			<p id={warningId} bind:this={warning} tabindex="-1">{messages.warning}</p>
			<Textarea
				id={phraseId}
				label={messages.phraseLabel}
				value={view.phrase}
				readonly
				rows={4}
				spellcheck={false}
				autocomplete="off"
				autocapitalize="off"
			/>
			<Button type="button" autofocus onclick={onHide}>{messages.close}</Button>
		</div>
	{/if}
</Dialog>

<style>
	.recovery-content {
		display: grid;
		gap: var(--dui-space-sm, 1rem);
	}

	.recovery-content p {
		margin: 0;
	}
</style>
