<script lang="ts">
	import { Button, Textarea } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'

	let {
		restoring,
		navigationOnly,
		restoreError,
		sessionError = false,
		navigationError,
		canRetryNavigation,
		draftRevision,
		onRetryNavigation,
		onsubmit
	}: {
		restoring: boolean
		navigationOnly: boolean
		restoreError: boolean
		sessionError?: boolean
		navigationError: boolean
		canRetryNavigation: boolean
		draftRevision: number
		onRetryNavigation: () => void
		onsubmit: (event: SubmitEvent) => void
	} = $props()
</script>

<p>{m['login.description']()}</p>

<form {onsubmit}>
	{#key draftRevision}
		<Textarea
			label={m['login.recovery_phrase']()}
			id="recovery-phrase"
			name="recoveryPhrase"
			rows={4}
			disabled={restoring}
			required
		></Textarea>
	{/key}
	{#if navigationError}
		<p role="alert">{m['login.navigation_error']()}</p>
		{#if canRetryNavigation}
			<Button type="button" disabled={restoring} onclick={onRetryNavigation}
				>{m['actions.retry']()}</Button
			>
		{/if}
	{:else if sessionError || restoreError}
		<p role="alert">{restoreError ? m['login.restore_error']() : m['login.session_error']()}</p>
	{/if}
	<Button type="submit" disabled={restoring}>
		{restoring
			? navigationOnly
				? m['login.opening_destination']()
				: m['status.restoring_subject']({ subject: m['nouns.account']({ count: 1 }) })
			: m['navigation.login']()}
	</Button>
</form>
