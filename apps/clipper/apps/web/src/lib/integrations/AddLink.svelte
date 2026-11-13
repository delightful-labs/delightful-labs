<script lang="ts">
	import { onDestroy, untrack } from 'svelte'
	import { useSelector } from '@xstate/svelte'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import { libraryViewSource, sameWorkflowMessage } from '../runtime/worker/view-source.js'
	import { Button, Dialog, FloatingActionButton, InputText, StatusMessage } from 'delightful-ui'
	import { action, t } from '../localization/index.js'

	let { actor }: { actor: LibraryClient } = $props()
	// Library keys this form by client: observation and commands share that exact scope.
	const client = untrack(() => actor)
	const source = libraryViewSource(client)
	const dialogId = $props.id()
	let open = $state(false)
	let url = $state('')
	const canAdd = useSelector(source, (render) => render.canAdd)
	const canOrganize = useSelector(source, (render) => render.view.canOrganize)
	const restoreCaptureId = useSelector(source, (render) => render.view.restoreCaptureId)
	const captureProblem = useSelector(
		source,
		(render) => render.view.captureProblemMessage,
		sameWorkflowMessage
	)
	const duplicate = useSelector(
		source,
		(render) => render.view.duplicateMessage,
		sameWorkflowMessage
	)

	onDestroy(() => {
		url = ''
	})
</script>

{#if $captureProblem}<StatusMessage {...$captureProblem} />{/if}

{#if $duplicate}<StatusMessage {...$duplicate} />{/if}

{#if $restoreCaptureId}
	{@const id = $restoreCaptureId}
	<Button
		appearance="flat"
		disabled={!$canOrganize}
		onclick={() =>
			client.send({
				type: 'ORGANIZE',
				request: { id, field: 'trashed', value: false }
			})}>{action('restore', 'article')}</Button
	>
{/if}

<FloatingActionButton
	type="button"
	aria-label={action('add', 'link')}
	title={action('add', 'link')}
	aria-haspopup="dialog"
	aria-controls={dialogId}
	disabled={!$canAdd}
	onclick={() => (open = true)}><span aria-hidden="true">+</span></FloatingActionButton
>

<Dialog id={dialogId} heading={action('add', 'link')} bind:open closedby="any">
	<form
		onsubmit={(event) => {
			event.preventDefault()
			client.send({ type: 'ADD', url })
			open = false
			url = ''
		}}
	>
		<InputText
			label={t('capture.url_label')}
			name="url"
			type="url"
			bind:value={url}
			required
			maxlength={8192}
			autocomplete="url"
			disabled={!$canAdd}
		/>
		<div class="dialog-actions">
			<Button type="button" onclick={() => (open = false)}>{t('actions.close')}</Button>
			<Button type="submit" disabled={!$canAdd}>{action('add', 'link')}</Button>
		</div>
	</form>
</Dialog>

<style>
	form {
		display: grid;
		gap: var(--dui-space-sm);
	}

	.dialog-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: end;
		gap: var(--dui-space-sm);
	}
</style>
