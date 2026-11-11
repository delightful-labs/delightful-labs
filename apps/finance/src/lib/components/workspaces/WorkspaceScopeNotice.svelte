<script lang="ts">
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import { Button, ScreenReaderText } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	let {
		active = true,
		failed = false,
		loading = false,
		onRetry
	}: { active?: boolean; failed?: boolean; loading?: boolean; onRetry: () => void } = $props()
	const message = $derived(
		!active
			? ''
			: loading
				? m['status.loading_subject']({ subject: m['nouns.workspace']({ count: 2 }) })
				: m['workspace.unavailable']()
	)
</script>

<ScreenReaderText role="status">{failed ? '' : message}</ScreenReaderText>
<ScreenReaderText role="alert">{failed ? message : ''}</ScreenReaderText>
{#if active}
	<p aria-hidden="true">{message}</p>
{/if}
{#if active && !loading}
	<p>
		<AppLink href="/settings/workspace"
			>{m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</AppLink
		>
	</p>
	<Button type="button" onclick={onRetry}>{m['actions.retry']()}</Button>
{/if}
