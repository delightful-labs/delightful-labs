<script lang="ts">
	import { Drawer } from 'delightful-ui'
	import { onMount } from 'svelte'
	import type { ReaderPreferences, ReaderPreferenceChange } from '../../reader/schema.js'
	import type { ReaderHeading } from '../../reader/structure.js'
	import { t } from '../../localization/index.js'
	import ReaderToolbar from './ReaderToolbar.svelte'

	let {
		sourceUrl,
		preferences,
		progress,
		focused,
		enabled,
		headings,
		onchange,
		onfocus,
		onreflow,
		onclose
	}: {
		sourceUrl: string | undefined
		preferences: ReaderPreferences
		progress: number
		focused: boolean
		enabled: boolean
		headings: ReaderHeading[]
		onchange: (change: ReaderPreferenceChange) => void
		onfocus: () => void
		onreflow: () => void
		onclose: () => void
	} = $props()
	let drawer: ReturnType<typeof Drawer> | undefined = $state()
	let toolbar: ReturnType<typeof ReaderToolbar> | undefined = $state()
	let mobile = $state(false)
	const modal = $derived(mobile && (drawer?.isOpen() ?? false) && !focused)

	export function getDrawer() {
		return drawer
	}
	export function isModal() {
		return modal
	}
	export function focusControl() {
		toolbar?.focusControl()
	}

	onMount(() => {
		const viewport = window.matchMedia('(max-width: 48rem)')
		const resize = () => {
			mobile = viewport.matches
		}
		resize()
		viewport.addEventListener('change', resize)
		return () => viewport.removeEventListener('change', resize)
	})
</script>

<Drawer
	bind:this={drawer}
	hidden={focused}
	class="reader-drawer"
	side="right"
	heading={t('reader.controls')}
	headingHidden
	showCloseButton={false}
	closeLabel={t('actions.close')}
	onopenchange={(open) => {
		onreflow()
		if (!open) onclose()
	}}
>
	<ReaderToolbar
		bind:this={toolbar}
		oncontents={() => {
			if (mobile) drawer?.close()
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
{#if modal}
	<button
		class="settings-dismiss"
		type="button"
		aria-label={t('actions.close')}
		onclick={() => drawer?.close()}
	></button>
{/if}

<style>
	:global(.reader-drawer) {
		--dui-drawer-width: clamp(18rem, 30vw, 24rem);
		--dui-drawer-padding: 0 0 0 var(--dui-spacing-md);
	}

	@media (max-width: 48rem) {
		:global(.reader-drawer) {
			--dui-drawer-width: calc(100% - 3.5rem);
			--dui-drawer-padding: 0 0 0 var(--dui-spacing-sm);
			grid-area: 1 / 1;
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
