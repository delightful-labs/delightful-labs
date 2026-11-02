<script lang="ts" generics="Result, Reason">
	import { Button } from 'delightful-ui'
	import type { ScopedFormView } from '../../contracts/scoped-form.js'
	let {
		retryLabel,
		view,
		subject,
		reasonText,
		invalidMessage,
		invalidMessages,
		successMessage,
		section = 'all',
		onRetryReadiness,
		action = 'save',
		messages = {},
		blockedRole = () => 'status'
	}: {
		retryLabel: string
		view: ScopedFormView<Result, Reason>
		subject: string
		reasonText: (reason: Reason) => string
		invalidMessage?: string
		invalidMessages?: readonly string[]
		successMessage?: (value: Result) => string
		section?: 'all' | 'readiness' | 'result'
		onRetryReadiness?: () => void
		action?: 'save' | 'archive'
		messages?: {
			sessionUnavailable?: string
			settling?: string
			scopeChanged?: string
			cancelled?: string
			closed?: string
			interruptedSaved?: string
			unknown?: string
		}
		blockedRole?: (reason: Reason) => 'alert' | 'status'
	} = $props()
	const validationMessages = $derived(
		invalidMessages ?? (invalidMessage === undefined ? [] : [invalidMessage])
	)
	const feedback = $derived(
		(view.feedbackLabels ?? []).flatMap((meta) =>
			section === 'all' || meta.section === section
				? meta.label({
						view,
						subject,
						reasonText,
						validationMessages,
						successMessage,
						action,
						messages,
						blockedRole
					})
				: []
		)
	)
</script>

{#each feedback as message}
	{#if message.role === 'alert'}
		<div role="alert">
			{#if 'paragraphs' in message}
				{#each message.paragraphs as text}<p>{text}</p>{/each}
			{:else}<p>{message.text}</p>{/if}
		</div>
	{:else}
		<p role={message.role}>{message.text}</p>
	{/if}
{/each}
{#if section !== 'result' && view.canRetryReadiness && onRetryReadiness}
	<Button type="button" onclick={onRetryReadiness}>{retryLabel}</Button>
{/if}
