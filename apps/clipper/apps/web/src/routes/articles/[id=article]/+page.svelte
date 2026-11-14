<script lang="ts">
	import { page } from '$app/state'
	import { useWorkerLibrary } from '../../../lib/runtime/worker/context.js'
	import { untrack, tick } from 'svelte'
	import type { LibraryClient } from '../../../lib/runtime/worker/client.js'
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

	// Observe only after OPEN for the exact client and URL in this reused route.
	let binding = $state.raw<{ owner: LibraryClient; id: string }>()
	let surface: { owner: LibraryClient; detach: () => void } | undefined
	let headings = $state<ReaderHeading[]>([])
	let footnote = $state<ReaderFootnote>()
	const runtime = useWorkerLibrary()
	const actor = $derived(runtime.actor)
	const id = $derived(page.params.id ?? '')
	const client = $derived(
		binding && binding.owner === actor && binding.id === id ? binding.owner : undefined
	)
	const footnoteId = $props.id()
	let accountDrawer: ReturnType<typeof AccountDrawer> | undefined = $state()
	const accountControl = $derived(accountDrawer?.getControl())
	let settingsDrawer: ReturnType<typeof ReaderSettingsDrawer> | undefined = $state()
	let navigation: ReturnType<typeof ReaderTopNavigation> | undefined = $state()
	const view = $derived($client?.view)
	const reading = $derived(view?.readerExperience)
	const reader = $derived($client?.readerId === id ? $client?.reader : undefined)
	const article = $derived($client?.article)
	const originalUrl = $derived($client?.sourceUrl)
	function send(event: Extract<LibraryIntent, { type: 'READER_EVENT' }>['event']) {
		client?.send({ type: 'READER_EVENT', event })
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
		client?.send({
			type: 'ORGANIZE',
			request: { id: article?.id ?? id, field: 'status', value: 'archive' }
		})
	}

	function restoreArticle() {
		client?.send({
			type: 'ORGANIZE',
			request: { id: article?.id ?? id, field: 'trashed', value: false }
		})
	}

	function ready(node: HTMLElement) {
		if (reader?.kind !== 'available' || !client) return
		headings = readerHeadings(node)
		const scroller = node.closest('main')
		if (scroller)
			surface = {
				owner: client,
				detach: client.attach({ root: node, scroller }, reader.document.id)
			}
	}
	function release() {
		const previous = surface
		surface = undefined
		previous?.detach()
		previous?.owner.send({ type: 'READER_EVENT', event: { type: 'DETACH' } })
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
		const routeId = id
		if (!owner) return
		return untrack(() => {
			owner.send({ type: 'OPEN', id: routeId })
			binding = { owner, id: routeId }
			return () => {
				release()
				owner.send({ type: 'CLOSE_READER' })
				binding = undefined
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
											onretryimage={(id) => client?.send({ type: 'RETRY_IMAGE', id })}
											onimageerror={(id, url) => client?.send({ type: 'IMAGE_ERROR', id, url })}
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
					{:else if $client?.readerId === id && view?.readerMessage}<StatusMessage
							{...view.readerMessage}
						/>{/if}
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
