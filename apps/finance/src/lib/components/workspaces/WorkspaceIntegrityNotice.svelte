<script lang="ts">
	import { Button, ScreenReaderText } from 'delightful-ui'
	import type { WorkspaceIntegrityView } from '#lib/machines/workspaces/workspace-integrity-owner.js'
	import { m } from '#lib/paraglide/messages.js'
	let { view, onRetry }: { view: WorkspaceIntegrityView; onRetry: () => void } = $props()
	const urgent = $derived(view.mode === 'failed' || view.mode === 'conflict')
	const message = $derived(
		view.mode === 'working'
			? m['workspace.integrity_working']()
			: view.mode === 'partial'
				? m['workspace.integrity_partial']()
				: view.mode === 'conflict'
					? m['workspace.integrity_conflict']()
					: view.mode === 'failed'
						? m['workspace.integrity_failed']()
						: ''
	)
</script>

<ScreenReaderText role="status">{urgent ? '' : message}</ScreenReaderText>
<ScreenReaderText role="alert">{urgent ? message : ''}</ScreenReaderText>
{#if view.mode !== 'working' && message}
	<p aria-hidden="true">{message}</p>
{/if}
{#if view.canRetry}<Button type="button" onclick={onRetry}>{m['actions.retry']()}</Button>{/if}
