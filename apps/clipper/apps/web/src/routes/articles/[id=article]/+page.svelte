<script lang="ts">
	import { page } from '$app/state'
	import { useWorkerLibrary } from '../../../lib/runtime/worker/context.js'
	import { untrack, tick } from 'svelte'
	import type { LibraryClient } from '../../../lib/runtime/worker/client.js'
	import type { LibraryRender } from '../../../lib/runtime/worker/views.js'
	import type { LibraryIntent } from '../../../lib/runtime/worker/protocol.js'
	import { Button, Heading, StatusMessage } from 'delightful-ui'
	import { t } from '../../../lib/localization/index.js'
	import AccountDrawer from '../../../lib/integrations/AccountDrawer.svelte'
	import ReaderSettingsDrawer from '../../../lib/components/reader/ReaderSettingsDrawer.svelte'
	import FootnotePreview from '../../../lib/components/reader/FootnotePreview.svelte'
	import ReaderActions from '../../../lib/components/reader/ReaderActions.svelte'
	import SavedContent from '../../../lib/integrations/SavedContent.svelte'
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
	let accountDrawer: ReturnType<typeof AccountDrawer> | undefined = $state()
	const accountControl = $derived(accountDrawer?.getControl())
	let settingsDrawer: ReturnType<typeof ReaderSettingsDrawer> | undefined = $state()
	let navigation: ReturnType<typeof ReaderTopNavigation> | undefined = $state()
	const view = $derived(snapshot?.view ?? actor?.getView().view)
	const reading = $derived(view?.readerExperience)
	const reader = $derived(snapshot?.reader)
	const article = $derived(snapshot?.article)
	const originalUrl = $derived(snapshot?.sourceUrl)
	function send(event: Extract<LibraryIntent, { type: 'READER_EVENT' }>['event']) {
		actor?.send({ type: 'READER_EVENT', event })
	}

	let showControls: ReturnType<typeof Button> | undefined = $state()
	let previousFocus = false
	$effect.pre(() => {
		const enteringFocus = reading?.focused ?? false
		if (!enteringFocus && !previousFocus) return
		previousFocus = enteringFocus
		let active = true
		void tick().then(() => {
			if (!active) return
			if (enteringFocus) showControls?.focus({ preventScroll: true })
			else settingsDrawer?.focusControl()
		})
		return () => {
			active = false
		}
	})

	function archiveArticle() {
		actor?.send({
			type: 'ORGANIZE',
			request: { id: article?.id ?? id, field: 'status', value: 'archive' }
		})
	}

	function restoreArticle() {
		actor?.send({
			type: 'ORGANIZE',
			request: { id: article?.id ?? id, field: 'trashed', value: false }
		})
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
<div class="page-workspace">
	<AccountDrawer bind:this={accountDrawer} focused={reading?.focused ?? false} />
	<div class="page-content" inert={accountDrawer?.isModal() ?? false}>
		{#if runtime.actor}
			{#key runtime.actor}{#key page.params.id}
					{#if reader?.kind === 'available' && view && reading}
						{#if !reading.focused}
							<ReaderTopNavigation
								bind:this={navigation}
								drawer={settingsDrawer?.getDrawer()}
								{accountControl}
							/>
						{/if}
						{#if reading.focused}
							<div class="reader-toggle" data-reader-overlay>
								<Button bind:this={showControls} onclick={() => send({ type: 'SHOW_CONTROLS' })}
									>{t('reader.show_controls')}</Button
								>
							</div>
						{/if}
						<div class="reader-workspace">
							<div class="reader-body" inert={settingsDrawer?.isModal() ?? false}>
								{#if reading.message}<StatusMessage {...reading.message} />{/if}
								<article>
									<Heading level="h1" size="xxl">{reader.document.title}</Heading>
									{#if article?.trashed}<ReaderActions
											trashed={article?.trashed === true}
											archived={article?.status === 'archive'}
											enabled={view.canOrganize}
											onarchive={archiveArticle}
											onrestore={restoreArticle}
										/>{/if}
									{#if view.readerMessage}<StatusMessage {...view.readerMessage} />{/if}

									<ReaderView preferences={reading.preferences}>
										<SavedContent
											asset={reader.asset}
											imageViews={view.imageViews}
											onretryimage={(id) => actor?.send({ type: 'RETRY_IMAGE', id })}
											onimageerror={(id, url) => actor?.send({ type: 'IMAGE_ERROR', id, url })}
											text={reader.text}
											sourceUrl={originalUrl}
											onready={ready}
											onrelease={() => release()}
											onlink={showFootnote}
										/>
									</ReaderView>
									{#if !article?.trashed}<footer>
											<ReaderActions
												trashed={article?.trashed === true}
												archived={article?.status === 'archive'}
												enabled={view.canOrganize}
												onarchive={archiveArticle}
												onrestore={restoreArticle}
											/>
										</footer>{/if}
								</article>
							</div>
							<ReaderSettingsDrawer
								bind:this={settingsDrawer}
								sourceUrl={originalUrl}
								preferences={reading.preferences}
								progress={reader.progress}
								focused={reading.focused}
								enabled={reading.enabled}
								{headings}
								onchange={(change) => send({ type: 'CHANGE', change })}
								onfocus={() => send({ type: 'FOCUS' })}
								onreflow={() => send({ type: 'REFLOW' })}
								onclose={() => navigation?.focusTrigger()}
							/>
						</div>
						<FootnotePreview
							id={footnoteId}
							note={footnote}
							onclose={closeFootnote}
							onfullnote={() => {
								footnote = undefined
								document.getElementById(footnoteId)?.hidePopover()
							}}
						/>
					{:else if view?.readerMessage}<StatusMessage {...view.readerMessage} />{/if}
				{/key}{/key}
		{/if}
	</div>
</div>

<style>
	footer {
		display: flex;
		justify-content: center;
		margin-block: var(--dui-space-md);
	}

	.reader-workspace {
		display: flex;
		align-items: flex-start;
		min-inline-size: 0;
	}

	.reader-body {
		flex: 1 1 0%;
		min-inline-size: 0;
	}

	.reader-toggle {
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
	}

	.page-workspace {
		position: relative;
		display: flex;
		min-inline-size: 0;
	}

	.page-content {
		flex: 1 1 0%;
		min-inline-size: 0;
	}

	@media (max-width: 48rem) {
		.reader-workspace {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}

		.reader-body {
			grid-area: 1 / 1;
		}

		.page-workspace {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}

		.page-content {
			grid-area: 1 / 1;
		}
	}
</style>
