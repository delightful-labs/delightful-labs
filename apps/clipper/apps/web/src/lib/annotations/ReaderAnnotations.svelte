<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { beforeNavigate } from '$app/navigation'
	import { Button, Heading, StatusMessage } from 'delightful-ui'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import { action, noun, t } from '../localization/index.js'
	import { measureReaderText, measureSelection, renderHighlights } from './surface.js'
	import type { AnnotationCommand } from './schema.js'
	import NoteEditor from './NoteEditor.svelte'
	import SharingPreview from './SharingPreview.svelte'
	let selected = $state(false)
	const previewDialogId = $props.id()
	let {
		client,
		documentId,
		root
	}: { client: LibraryClient; documentId: string; root: HTMLElement | undefined } = $props()
	const annotations = $derived($client.view.annotations)
	const preview = $derived(annotations.preview)
	function send(command: AnnotationCommand) {
		client?.send({ type: 'ANNOTATION', command })
	}
	$effect(() => {
		const node = root
		if (!node) return
		return untrack(() => {
			const owner = client
			const scope = documentId
			if (!owner) return
			owner.send({
				type: 'ANNOTATION',
				command: { type: 'OPEN', documentId: scope, text: measureReaderText(node) }
			})
			return () => owner.send({ type: 'ANNOTATION', command: { type: 'CLOSE' } })
		})
	})
	$effect(() => {
		const node = root
		if (!node) return
		const spans = annotations.highlights.flatMap((item) => (item.range ? [item.range] : []))
		return renderHighlights(node, spans, 'clipper-annotations')
	})
	function addHighlight() {
		if (!root) return
		const measured = measureSelection(root)
		if (measured) send({ type: 'HIGHLIGHT', documentId, ...measured })
	}
	function leave(event: BeforeUnloadEvent) {
		if (annotations.pending) {
			event.preventDefault()
			event.returnValue = ''
		}
	}
	onMount(() => {
		const changed = () => {
			const selection = document.getSelection()
			selected =
				!!root &&
				!!selection &&
				!selection.isCollapsed &&
				!!selection.anchorNode &&
				!!selection.focusNode &&
				root.contains(selection.anchorNode) &&
				root.contains(selection.focusNode)
		}
		document.addEventListener('selectionchange', changed)
		window.addEventListener('beforeunload', leave)
		return () => {
			document.removeEventListener('selectionchange', changed)
			window.removeEventListener('beforeunload', leave)
		}
	})
	beforeNavigate(({ cancel }) => {
		if (annotations.pending && !window.confirm(t('status.leave_warning'))) cancel()
	})
</script>

<section aria-label={noun('highlight', 2)} aria-busy={annotations.pending}>
	<div class="annotation-actions">
		<Button
			disabled={!annotations.enabled || !selected}
			onmousedown={(event) => event.preventDefault()}
			onclick={addHighlight}>{action('add', 'highlight')}</Button
		>
		{#if !annotations.notes.length}<Button
				disabled={!annotations.enabled}
				onclick={() => send({ type: 'ADD_NOTE', documentId })}>{action('add', 'note')}</Button
			>{/if}
	</div>
	{#if annotations.message}<StatusMessage {...annotations.message} />{/if}
	{#each annotations.notes as note (note.id)}
		<NoteEditor {note} {documentId} enabled={annotations.enabled} {send} />
		<Button
			disabled={!annotations.enabled || annotations.pending || !!note.drafts.length}
			aria-haspopup="dialog"
			aria-controls={previewDialogId}
			onclick={() => send({ type: 'PREVIEW_NOTE', documentId, id: note.id })}
			>{t('publication.preview_action')}</Button
		>
	{/each}
	{#key client}
		{#key preview.requestId}
			<SharingPreview
				{client}
				{documentId}
				id={previewDialogId}
				view={preview}
				enabled={annotations.enabled && !annotations.pending}
			/>
		{/key}
	{/key}
	{#if annotations.highlights.length}<Heading level="h2">{noun('highlight', 2)}</Heading>{/if}
	{#each annotations.highlights as highlight (highlight.id)}
		<div class="annotation" role="group" aria-label={noun('highlight')}>
			<blockquote>{highlight.quote}</blockquote>
			{#if !highlight.range}<StatusMessage
					variant="info"
					text={t('status.unavailable_subject', { subject: noun('highlight') })}
				/>{/if}
			{#each highlight.notes as note (note.id)}<NoteEditor
					{note}
					{documentId}
					enabled={annotations.enabled}
					{send}
				/>{/each}
			<div class="annotation-actions">
				<Button
					disabled={!annotations.enabled ||
						annotations.pending ||
						highlight.notes.some((note) => note.drafts.length > 0)}
					aria-haspopup="dialog"
					aria-controls={previewDialogId}
					onclick={() => send({ type: 'PREVIEW_HIGHLIGHT', documentId, id: highlight.id })}
					>{t('publication.preview_action')}</Button
				>
				{#if !highlight.notes.length}<Button
						disabled={!annotations.enabled}
						onclick={() => send({ type: 'ADD_NOTE', documentId, highlightId: highlight.id })}
						>{action('add', 'note')}</Button
					>{/if}
				<Button
					appearance="flat"
					disabled={!annotations.enabled}
					onclick={() => send({ type: 'DELETE_HIGHLIGHT', documentId, id: highlight.id })}
					>{t('actions.remove_name', { name: noun('highlight') })}</Button
				>
			</div>
		</div>
	{/each}
</section>

<style>
	section {
		display: grid;
		gap: var(--dui-space-md);
	}
	.annotation {
		display: grid;
		gap: var(--dui-space-sm);
	}
	.annotation-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-sm);
	}
	:global(::highlight(clipper-annotations)) {
		background-color: Mark;
		color: MarkText;
	}
</style>
