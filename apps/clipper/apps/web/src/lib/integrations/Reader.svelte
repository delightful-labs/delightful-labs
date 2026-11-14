<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import type { LibraryIntent } from '../runtime/worker/protocol.js'
	import { StatusMessage } from 'delightful-ui'
	import { t } from '../localization/index.js'
	import ReaderView from '../components/reader/ReaderView.svelte'
	import {
		readerHeadings,
		footnoteFromClick,
		type ReaderHeading,
		type ReaderFootnote
	} from '../reader/structure.js'
	let { actor, id }: { actor: LibraryClient; id: string } = $props()
	const client = untrack(() => actor)
	const articleId = untrack(() => id)
	// Create the DOM surface only after onMount has sent OPEN.
	let mounted = $state(false)
	let detachSurface: (() => void) | undefined
	let headings = $state<ReaderHeading[]>([])
	let footnote = $state<ReaderFootnote>()
	const footnoteId = $props.id()
	const view = $derived($client.view)
	const reading = $derived(view.readerExperience)
	const reader = $derived(mounted && $client.readerId === articleId ? $client.reader : undefined)
	const article = $derived($client.article)
	const originalUrl = $derived($client.sourceUrl)
	function send(event: Extract<LibraryIntent, { type: 'READER_EVENT' }>['event']) {
		client.send({ type: 'READER_EVENT', event })
	}

	function ready(node: HTMLElement) {
		if (reader?.kind !== 'available') return
		headings = readerHeadings(node)
		const scroller = node.closest('main')
		if (scroller) detachSurface = client.attach({ root: node, scroller }, reader.document.id)
	}
	function release() {
		detachSurface?.()
		detachSurface = undefined
		send({ type: 'DETACH' })
		headings = []
		footnote = undefined
	}
	function showFootnote(event: MouseEvent, root: HTMLElement) {
		const note = footnoteFromClick(root, event)
		const popover = document.getElementById(footnoteId)
		if (!note || !popover?.showPopover) return
		event.preventDefault()
		footnote = note
		popover.showPopover({ source: note.trigger })
	}
	function closeFootnote() {
		footnote?.trigger.focus()
		footnote = undefined
	}
	onMount(() => {
		client.send({ type: 'OPEN', id: articleId })
		mounted = true
		return () => {
			release()
			client.send({ type: 'CLOSE_READER' })
		}
	})
</script>

<svelte:head
	><title>{reader?.kind === 'available' ? reader.document.title : t('reader.heading')}</title
	></svelte:head
>
{#if reader?.kind === 'available'}
	<ReaderView
		title={reader.document.title}
		asset={reader.asset}
		imageViews={view.imageViews}
		onretryimage={(id) => client.send({ type: 'RETRY_IMAGE', id })}
		onimageerror={(id, url) => client.send({ type: 'IMAGE_ERROR', id, url })}
		text={reader.text}
		sourceUrl={originalUrl}
		preferences={reading.preferences}
		progress={reader.progress}
		focused={reading.focused}
		enabled={reading.enabled}
		canOrganize={view.canOrganize}
		trashed={article?.trashed === true}
		archived={article?.status === 'archive'}
		{headings}
		{footnote}
		{footnoteId}
		message={reading.message}
		readingMessage={view.readerMessage}
		onchange={(change) => send({ type: 'CHANGE', change })}
		onfocus={() => send({ type: 'FOCUS' })}
		onshowcontrols={() => send({ type: 'SHOW_CONTROLS' })}
		onreflow={() => send({ type: 'REFLOW' })}
		onarchive={() =>
			client.send({
				type: 'ORGANIZE',
				request: { id: article?.id ?? articleId, field: 'status', value: 'archive' }
			})}
		onrestore={() =>
			client.send({
				type: 'ORGANIZE',
				request: { id: article?.id ?? articleId, field: 'trashed', value: false }
			})}
		onready={ready}
		onrelease={release}
		onlink={showFootnote}
		onfootnoteclose={closeFootnote}
		onfullnote={() => {
			footnote = undefined
			document.getElementById(footnoteId)?.hidePopover()
		}}
	/>
{:else if $client.readerId === articleId && view.readerMessage}<StatusMessage
		{...view.readerMessage}
	/>{/if}
