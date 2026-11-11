<script lang="ts">
	import { Button, Dialog, SkipButton } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'

	let {
		children,
		appId,
		serverUrl,
		browserOrigin,
		accountId,
		onOpenStateInspector
	}: {
		children: Snippet
		appId: string
		serverUrl: string
		browserOrigin?: string | undefined
		accountId?: string | undefined
		onOpenStateInspector: () => void
	} = $props()
	let open = $state(false)
	const dialogId = $props.id()
</script>

<SkipButton aria-haspopup="dialog" aria-controls={dialogId} onclick={() => (open = true)}>
	{m['developer.menu']()}
</SkipButton>

<Dialog id={dialogId} heading={m['developer.menu']()} bind:open closedby="any">
	<dl>
		<dt>{m['developer.browser_origin']()}</dt>
		<dd><code>{browserOrigin || m['developer.unavailable']()}</code></dd>
		<dt>{m['developer.jazz_app_id']()}</dt>
		<dd><code>{appId || m['developer.unavailable']()}</code></dd>
		<dt>{m['developer.jazz_server_url']()}</dt>
		<dd><code>{serverUrl || m['developer.unavailable']()}</code></dd>
		<dt>{m['developer.account_id']()}</dt>
		<dd><code>{accountId || m['developer.unavailable']()}</code></dd>
	</dl>
	<Button type="button" onclick={onOpenStateInspector}
		>{m['actions.open_subject']({ subject: m['developer.stately_inspector']() })}</Button
	>
	<a href="https://v2.inspector.jazz.tools/" target="_blank" rel="noopener noreferrer"
		>{m['actions.open_subject']({ subject: m['developer.jazz_inspector']() })}</a
	>
	{@render children()}
	<Button type="button" onclick={() => (open = false)}>{m['actions.close']()}</Button>
</Dialog>
