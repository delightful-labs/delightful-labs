<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { stopAfterShutdown } from '#lib/runtime/actor-lifecycle.js'
	import { createActor, type ActorRefFrom } from 'xstate'
	import {
		imageEditorMachine,
		imageEditorPresentation,
		type ImageEditorEvent
	} from '#lib/machines/images/image-editor.js'
	import type { ImageSelectionMode } from '#lib/domain/image-editor-geometry.js'
	import ImageEditorView from './ImageEditorView.svelte'

	// The consumer keys this component by file and owns the containing dialog.
	let {
		file,
		actor: providedActor,
		mode = 'perspective',
		oncomplete,
		oncancel
	}: {
		file: File
		actor?: ActorRefFrom<typeof imageEditorMachine>
		mode?: ImageSelectionMode
		oncomplete?: (file: File) => void
		oncancel?: () => void
	} = $props()
	const ownedActor = untrack(() =>
		providedActor ? undefined : createActor(imageEditorMachine, { input: { file, mode } })
	)
	const actor = untrack(() => {
		const selected = providedActor ?? ownedActor
		if (!selected) throw new Error('Missing image editor actor')
		return selected
	})
	let view = $state.raw(imageEditorPresentation(actor.getSnapshot()))

	function send(event: ImageEditorEvent) {
		if (actor.getSnapshot().status === 'active') actor.send(event)
		else if (event.type === 'CANCEL') oncancel?.()
	}
	onMount(() => {
		const subscription = actor.subscribe({
			next: (snapshot) => {
				view = imageEditorPresentation(snapshot)
				if (snapshot.status !== 'done') return
				if (snapshot.output.kind === 'applied') oncomplete?.(snapshot.output.file)
				else if (snapshot.output.kind !== 'failed') oncancel?.()
			},
			error: () => {
				view = imageEditorPresentation(actor.getSnapshot())
			}
		})
		ownedActor?.start()
		return () => {
			subscription.unsubscribe()
			if (ownedActor) stopAfterShutdown(ownedActor)
		}
	})
</script>

<ImageEditorView {view} oncommand={send} />
