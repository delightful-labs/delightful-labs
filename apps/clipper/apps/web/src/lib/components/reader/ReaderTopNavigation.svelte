<script lang="ts">
	import type { Snippet } from 'svelte'
	import TopNavigation from '../../integrations/TopNavigation.svelte'
	import { Button, Icon, type Drawer } from 'delightful-ui'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	import SettingsIcon from 'tdesign-icons-svg/src/setting-1.svg?component'
	import { t } from '../../localization/index.js'

	let {
		drawer,
		accountControl
	}: {
		drawer: ReturnType<typeof Drawer> | undefined
		accountControl: Snippet | undefined
	} = $props()
	const drawerOpen = $derived(drawer?.isOpen() ?? false)
	let trigger: ReturnType<typeof Button> | undefined = $state()

	export function focusTrigger() {
		trigger?.focus({ preventScroll: true })
	}
</script>

<div class="reader-navigation" data-reader-overlay>
	<TopNavigation label={t('reader.heading')}>
		{#if accountControl}<li>{@render accountControl()}</li>{/if}
		<li>
			<Button
				bind:this={trigger}
				type="button"
				aria-label={t('reader.controls')}
				aria-controls={drawer?.getId()}
				aria-expanded={drawerOpen}
				onclick={() => drawer?.toggle()}
			>
				<Icon icon={drawerOpen ? CloseIcon : SettingsIcon} width="24" height="24" />
			</Button>
		</li>
	</TopNavigation>
</div>

<style>
	.reader-navigation {
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
	}
</style>
