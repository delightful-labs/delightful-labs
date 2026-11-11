<script lang="ts">
	import Icon from '../navigation/AppIcon.svelte'
	import { Button } from 'delightful-ui'
	import LoadingContent from '../shared/LoadingContent.svelte'
	import RefreshIcon from 'tdesign-icons-svg/src/refresh.svg?component'
	import { m } from '#lib/paraglide/messages.js'

	let {
		error = false,
		workspace = false,
		message,
		onRetry
	}: {
		error?: boolean
		workspace?: boolean
		message?: string | undefined
		onRetry?: () => void
	} = $props()
</script>

<div class:recoverable={error && Boolean(onRetry)}>
	<LoadingContent
		style={error && onRetry ? '--dui-loading-screen-min-height: auto' : undefined}
		variant={error ? 'error' : 'loading'}
		text={message ??
			(workspace && error
				? m['workspace.setup_error']()
				: workspace
					? m['workspace.loading']()
					: error
						? m['database.start_error']()
						: m['database.starting']())}
	/>
	{#if error && onRetry}
		<Button type="button" onclick={onRetry}>
			<Icon style="width: 1em; height: 1em;" icon={RefreshIcon} />
			{m['actions.retry']()}
		</Button>
	{/if}
</div>

<style>
	.recoverable {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: var(--dui-space-sm, 1rem);
	}
</style>
