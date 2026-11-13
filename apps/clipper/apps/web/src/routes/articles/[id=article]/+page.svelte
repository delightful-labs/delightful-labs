<script lang="ts">
	import { page } from '$app/state'
	import { useWorkerLibrary } from '../../../lib/runtime/worker/context.js'
	import { untrack } from 'svelte'
	import type { LibraryClient } from '../../../lib/runtime/worker/client.js'
	import type { LibraryRender } from '../../../lib/runtime/worker/views.js'
	import type { LibraryIntent } from '../../../lib/runtime/worker/protocol.js'
	import { StatusMessage } from 'delightful-ui'
	import { t } from '../../../lib/localization/index.js'
	import AccountDrawer from '../../../lib/integrations/AccountDrawer.svelte'
	import ReaderView from '../../../lib/components/reader/ReaderView.svelte'
	import {
		readerHeadings,
		footnoteFromClick,
		type ReaderHeading,
		type ReaderFootnote
	} from '../../../lib/reader/structure.js'
	import ReaderTopNavigation from '../../../lib/components/reader/ReaderTopNavigation.svelte'

	let snapshot = $state<LibraryRender>()
	let detachSurface: (() => void) | undefined
	let headings = $state<ReaderHeading[]>([])
	let footnote = $state<ReaderFootnote>()
	const runtime = useWorkerLibrary()
	const actor = $derived(runtime.actor)
	const id = $derived(page.params.id ?? '')
	const footnoteId = $props.id()
	let readerView: ReturnType<typeof ReaderView> | undefined = $state()
	let navigation: ReturnType<typeof ReaderTopNavigation> | undefined = $state()
	const view = $derived(snapshot?.view ?? actor?.getView().view)
	const reading = $derived(view?.readerExperience)
	const reader = $derived(snapshot?.reader)
	const article = $derived(snapshot?.article)
	const originalUrl = $derived(snapshot?.sourceUrl)
	function send(event: Extract<LibraryIntent, { type: 'READER_EVENT' }>['event']) {
		actor?.send({ type: 'READER_EVENT', event })
	}

	function ready(node: HTMLElement) {
		if (reader?.kind !== 'available') return
		headings = readerHeadings(node)
		const scroller = node.closest('main')
		if (scroller) detachSurface = actor?.attach({ root: node, scroller }, reader.document.id)
	}
	function release(owner: LibraryClient | undefined = actor) {
		detachSurface?.()
		detachSurface = undefined
		owner?.send({ type: 'READER_EVENT', event: { type: 'DETACH' } })
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
	$effect(() => {
		const owner = actor
		const documentId = id
		if (!owner) return
		return untrack(() => {
			const subscription = owner.subscribe((value) => (snapshot = value))
			owner.send({ type: 'OPEN', id: documentId })
			snapshot = owner.getView()
			return () => {
				release(owner)
				subscription.unsubscribe()
				owner.send({ type: 'CLOSE_READER' })
				snapshot = undefined
			}
		})
	})
</script>

<svelte:head
	><title>{reader?.kind === 'available' ? reader.document.title : t('reader.heading')}</title
	></svelte:head
>
<AccountDrawer focused={reading?.focused ?? false} showControl={false}>
	{#snippet children(accountControl)}
		{#if runtime.actor}
			{#key runtime.actor}{#key page.params.id}
					{#if reader?.kind === 'available' && view && reading}
						{#if !reading.focused}
							<ReaderTopNavigation
								bind:this={navigation}
								drawer={readerView?.getDrawer()}
								{accountControl}
							/>
						{/if}
						<ReaderView
							bind:this={readerView}
							ondrawerclose={() => navigation?.focusTrigger()}
							title={reader.document.title}
							asset={reader.asset}
							imageViews={view.imageViews}
							onretryimage={(id) => actor?.send({ type: 'RETRY_IMAGE', id })}
							onimageerror={(id, url) => actor?.send({ type: 'IMAGE_ERROR', id, url })}
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
								actor?.send({
									type: 'ORGANIZE',
									request: { id: article?.id ?? id, field: 'status', value: 'archive' }
								})}
							onrestore={() =>
								actor?.send({
									type: 'ORGANIZE',
									request: { id: article?.id ?? id, field: 'trashed', value: false }
								})}
							onready={ready}
							onrelease={() => release()}
							onlink={showFootnote}
							onfootnoteclose={closeFootnote}
							onfullnote={() => {
								footnote = undefined
								document.getElementById(footnoteId)?.hidePopover()
							}}
						/>
					{:else if view?.readerMessage}<StatusMessage {...view.readerMessage} />{/if}
				{/key}{/key}
		{/if}
	{/snippet}
</AccountDrawer>
