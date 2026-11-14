<script lang="ts">
	import type { Snippet } from 'svelte'
	import FootnotePreview from '../components/reader/FootnotePreview.svelte'
	import { footnoteFromClick, type ReaderFootnote } from '../reader/structure.js'
	let {
		children
	}: {
		children: Snippet<[(event: MouseEvent, root: HTMLElement) => void, () => void]>
	} = $props()
	const id = $props.id()
	let note = $state<ReaderFootnote>()
	function show(event: MouseEvent, root: HTMLElement) {
		const next = footnoteFromClick(root, event)
		const popover = root.ownerDocument.getElementById(id)
		if (!next || !popover?.showPopover) return
		event.preventDefault()
		note = next
		popover.showPopover({ source: next.trigger })
	}
	function clear() {
		note = undefined
		document.getElementById(id)?.hidePopover()
	}
	function close() {
		if (note?.trigger.isConnected) note.trigger.focus()
		note = undefined
	}
</script>

{@render children(show, clear)}
<FootnotePreview {id} {note} onclose={close} onfullnote={clear} />
