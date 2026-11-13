<script lang="ts">
	import { Button, Drawer, Heading, StatusMessage } from 'delightful-ui'
	import { onMount, tick } from 'svelte'
	import type { ImageView } from '../../images/view-machine.js'
	import type { AssetResult } from '../../contracts/storage.js'
	import type { WorkflowMessage } from '../../contracts/feedback.js'
	import type { ReaderPreferences, ReaderPreferenceChange } from '../../reader/schema.js'
	import type { ReaderHeading, ReaderFootnote } from '../../reader/structure.js'
	import { t } from '../../localization/index.js'
	import SavedContent from '../../integrations/SavedContent.svelte'
	import ReaderToolbar from './ReaderToolbar.svelte'
	import ReaderActions from './ReaderActions.svelte'
	import FootnotePreview from './FootnotePreview.svelte'
	let {
		ondrawerclose,
		title,
		asset,
		imageViews = {},
		onretryimage,
		onimageerror,
		text,
		sourceUrl,
		preferences,
		progress,
		focused,
		enabled,
		canOrganize,
		trashed,
		archived,
		headings,
		footnote,
		footnoteId,
		message,
		readingMessage,
		onchange,
		onfocus,
		onshowcontrols,
		onreflow,
		onarchive,
		onrestore,
		onready,
		onrelease,
		onlink,
		onfullnote,
		onfootnoteclose
	}: {
		ondrawerclose: () => void
		title: string
		asset: AssetResult
		imageViews?: Record<string, ImageView>
		onretryimage?: (url: string) => void
		onimageerror?: ((id: string, url: string) => void) | undefined
		text: string
		sourceUrl: string | undefined
		preferences: ReaderPreferences
		progress: number
		focused: boolean
		enabled: boolean
		canOrganize: boolean
		trashed: boolean
		archived: boolean
		headings: ReaderHeading[]
		footnote: ReaderFootnote | undefined
		footnoteId: string
		message: WorkflowMessage | undefined
		readingMessage: WorkflowMessage | undefined
		onchange: (change: ReaderPreferenceChange) => void
		onfocus: () => void
		onshowcontrols: () => void
		onreflow: () => void
		onarchive: () => void
		onrestore: () => void
		onready: (node: HTMLElement) => void
		onrelease: () => void
		onlink: (event: MouseEvent, node: HTMLElement) => void
		onfullnote: () => void
		onfootnoteclose: () => void
	} = $props()
	let drawer: ReturnType<typeof Drawer> | undefined = $state()

	export function getDrawer() {
		return drawer
	}

	const drawerOpen = $derived(drawer?.isOpen() ?? false)
	let previousFocus = false
	let showControls: ReturnType<typeof Button> | undefined = $state()
	let toolbar: ReturnType<typeof ReaderToolbar> | undefined = $state()
	let mobile = $state(false)
	const drawerModal = $derived(mobile && drawerOpen && !focused)
	onMount(() => {
		const viewport = window.matchMedia('(max-width: 48rem)')
		mobile = viewport.matches
		const resize = () => {
			mobile = viewport.matches
		}
		viewport.addEventListener('change', resize)
		return () => viewport.removeEventListener('change', resize)
	})

	function closeDrawer() {
		drawer?.close()
	}

	$effect.pre(() => {
		const enteringFocus = focused
		if (!enteringFocus && !previousFocus) return
		previousFocus = enteringFocus
		let active = true
		void tick().then(() => {
			if (!active) return
			if (enteringFocus) showControls?.focus({ preventScroll: true })
			else toolbar?.focusControl()
		})
		return () => {
			active = false
		}
	})
</script>

<section
	class="reader-workspace"
	class:focused
	data-drawer-open={drawerOpen}
	aria-label={t('reader.heading')}
>
	{#if focused}
		<div class="reader-toggle" data-reader-overlay>
			<Button bind:this={showControls} onclick={onshowcontrols}>{t('reader.show_controls')}</Button>
		</div>
	{/if}
	<div class="reader-panels">
		<div class="reader-body" inert={drawerModal}>
			{#if message}<StatusMessage {...message} />{/if}
			<article>
				<div class="reader-heading">
					<Heading level="h1" size="xxl">{title}</Heading>
				</div>
				{#if trashed}<ReaderActions
						{trashed}
						{archived}
						enabled={canOrganize}
						{onarchive}
						{onrestore}
					/>{/if}
				{#if readingMessage}<StatusMessage {...readingMessage} />{/if}
				<div
					style:--reader-font={preferences.font === 'serif'
						? 'ui-serif, Georgia, Cambria, serif'
						: 'system-ui, sans-serif'}
					style:--reader-size={preferences.size + 'px'}
					style:--reader-spacing={preferences.spacing}
					style:--reader-width={preferences.width + '%'}
				>
					<SavedContent
						{imageViews}
						{onretryimage}
						{onimageerror}
						{asset}
						{text}
						{sourceUrl}
						{onready}
						{onrelease}
						{onlink}
					/>
				</div>
				{#if !trashed}<footer>
						<ReaderActions {trashed} {archived} enabled={canOrganize} {onarchive} {onrestore} />
					</footer>{/if}
			</article>
		</div>
		<Drawer
			hidden={focused}
			class="reader-drawer"
			bind:this={drawer}
			side="right"
			heading={t('reader.controls')}
			headingHidden
			showCloseButton={false}
			closeLabel={t('actions.close')}
			onopenchange={(open) => {
				onreflow()
				if (!open) ondrawerclose()
			}}
		>
			<ReaderToolbar
				bind:this={toolbar}
				oncontents={() => {
					if (mobile) closeDrawer()
				}}
				{sourceUrl}
				{preferences}
				{progress}
				{enabled}
				{headings}
				onchange={(change) => {
					onreflow()
					onchange(change)
				}}
				{onfocus}
			/>
		</Drawer>
	</div>
	{#if drawerModal}
		<button
			class="settings-dismiss"
			type="button"
			aria-label={t('actions.close')}
			onclick={closeDrawer}
		></button>
	{/if}
	<FootnotePreview id={footnoteId} note={footnote} {onfullnote} onclose={onfootnoteclose} />
</section>

<style>
	.reader-workspace {
		--dui-drawer-width: clamp(18rem, 30vw, 24rem);
		--dui-drawer-padding: 0 0 0 var(--dui-spacing-md);
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		min-inline-size: 0;
	}

	.reader-panels {
		grid-area: 1 / 1;
		display: flex;
		align-items: flex-start;
		min-inline-size: 0;
	}

	.reader-body {
		flex: 1 1 0%;
		min-inline-size: 0;
	}

	.reader-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
	}

	.reader-toggle {
		grid-area: 1 / 1;
		align-self: start;
		justify-self: end;
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
	}

	footer {
		display: flex;
		justify-content: center;
		margin-block: var(--dui-space-md);
	}

	@media (max-width: 48rem) {
		.reader-workspace {
			--dui-drawer-width: calc(100% - 3.5rem);
			--dui-drawer-padding: 0 0 0 var(--dui-spacing-sm);
		}

		.reader-panels {
			display: grid;
			grid-template-columns: minmax(0, 1fr);
		}

		.reader-body,
		.reader-panels :global(.reader-drawer) {
			grid-area: 1 / 1;
		}

		.reader-panels :global(.reader-drawer) {
			justify-self: end;
			z-index: 2;
		}

		.settings-dismiss {
			grid-area: 1 / 1;
			align-self: start;
			justify-self: start;
			position: sticky;
			inset-block-start: 0;
			inline-size: 3.5rem;
			block-size: var(--dui-drawer-height);
			padding: 0;
			border: 0;
			background: transparent;
			z-index: 2;
		}
	}
</style>
