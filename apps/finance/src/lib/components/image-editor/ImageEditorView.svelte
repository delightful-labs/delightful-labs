<script lang="ts">
	import { StatusMessage } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import type {
		ImageEditorEvent,
		ImageEditorPresentation
	} from '#lib/machines/images/image-editor.js'
	import ImageEditorControls from './ImageEditorControls.svelte'
	import ImageEditorSurface from './ImageEditorSurface.svelte'

	let {
		view,
		oncommand
	}: { view: ImageEditorPresentation; oncommand: (event: ImageEditorEvent) => void } = $props()
	const progress = $derived(
		{
			loading: m['image_editor.loading'](),
			rendering: m['image_editor.rendering'](),
			exporting: m['image_editor.exporting'](),
			closing: m['image_editor.closing'](),
			editing: '',
			preview: '',
			failed: '',
			finished: ''
		}[view.status]
	)
</script>

<section class="editor" aria-label={m['image_editor.edit']()} aria-busy={view.busy}>
	<p>{m['image_editor.instructions']()}</p>
	{#if view.viewport.kind === 'selection'}
		<ImageEditorSurface
			pixels={view.viewport.pixels}
			selection={view.viewport.selection}
			adjustments={view.viewport.adjustments}
			enabled={view.viewport.enabled}
			{oncommand}
		/>
	{:else if view.viewport.kind === 'preview'}
		<ImageEditorSurface pixels={view.viewport.pixels} {oncommand} />
	{/if}
	{#if view.status === 'failed'}
		<StatusMessage variant="error" text={m['image_editor.failed']()} />
	{:else if progress}
		<StatusMessage variant="loading" text={progress} />
	{/if}
	<ImageEditorControls {view} {oncommand} />
</section>

<style>
	.editor {
		display: grid;
		gap: var(--dui-spacing-md, 1rem);
		min-width: 0;
	}
</style>
