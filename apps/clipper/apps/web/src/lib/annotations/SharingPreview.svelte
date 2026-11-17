<script lang="ts">
	import { untrack } from 'svelte'
	import { Button, Dialog, StatusMessage, Textarea } from 'delightful-ui'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import type { selectSharingPreview } from './sharing-preview.js'
	import { noun, t } from '../localization/index.js'
	let {
		client,
		documentId,
		id,
		view,
		enabled
	}: {
		client: LibraryClient
		documentId: string
		id: string
		view: ReturnType<typeof selectSharingPreview>
		enabled: boolean
	} = $props()
	// The parent keys this native dialog by client and request. Capture its original
	// binding eagerly: queued close events must never read a newer render's scope.
	const binding = untrack(() => ({
		client,
		documentId,
		requestId: view.requestId,
		noteId: view.noteId
	}))
	function close() {
		binding.client.send({
			type: 'ANNOTATION',
			command: {
				type: 'CLOSE_PREVIEW',
				documentId: binding.documentId,
				requestId: binding.requestId
			}
		})
	}
	function retry() {
		if (binding.noteId)
			binding.client.send({
				type: 'ANNOTATION',
				command: { type: 'PREVIEW_NOTE', documentId: binding.documentId, id: binding.noteId }
			})
	}
</script>

<Dialog
	{id}
	heading={t('publication.preview_heading')}
	open={view.open}
	closedby="any"
	onclose={(event) => {
		if (!event.currentTarget.open) close()
	}}
>
	<div class="preview-content" aria-busy={view.pending}>
		{#if view.message}<StatusMessage {...view.message} />{/if}
		{#if view.value}
			<dl>
				<dt>{t('publication.account')}</dt>
				<dd><code>{view.value.publishingDid}</code></dd>
				{#if 'record' in view.value}<dt>{t('capture.url_label')}</dt>
					<dd>
						<a href={view.value.record.target.source} target="_blank" rel="noreferrer"
							>{view.value.record.target.source}</a
						>
					</dd>{/if}
			</dl>
			{#if 'record' in view.value && view.value.record.motivation === 'commenting'}<Textarea
					readonly
					label={noun('note')}
					defaultValue={view.value.record.body.value}
				/>{/if}
		{/if}
		{#if view.publication}<output><code>{view.publication.uri}</code></output>{/if}
		<div class="preview-actions">
			{#if view.authorize && view.value}<Button
					disabled={!enabled}
					onclick={() =>
						view.value && binding.client.authorizePublication(view.value.publishingDid)}
					>{t('account.atproto.sign_in')}</Button
				>{/if}
			<Button onclick={close}>{t('actions.close')}</Button>
			{#if view.retry && binding.noteId}<Button disabled={!enabled} onclick={retry}
					>{t('actions.retry')}</Button
				>{/if}
		</div>
	</div>
</Dialog>

<style>
	.preview-content {
		display: grid;
		gap: var(--dui-space-sm);
		overflow-wrap: anywhere;
	}
	.preview-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-sm);
	}
</style>
