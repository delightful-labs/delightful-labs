<script lang="ts">
	import type { Snippet } from 'svelte'
	import TopNavigation from '../../integrations/TopNavigation.svelte'
	import { Button, Icon } from 'delightful-ui'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	import SettingsIcon from 'tdesign-icons-svg/src/setting-1.svg?component'
	import { t } from '../../localization/index.js'

	let {
		controlsId,
		open,
		ontoggle,
		accountControl
	}: {
		controlsId: string
		open: boolean
		ontoggle: () => void
		accountControl: Snippet | undefined
	} = $props()
	let trigger: ReturnType<typeof Button> | undefined = $state()

	export function focusTrigger() {
		trigger?.focus({ preventScroll: true })
	}
</script>

<div class="reader-navigation" data-reader-overlay>
	<TopNavigation label={t('reader.heading')}>
		{#if accountControl}<li>{@render accountControl()}</li>{/if}
		<li class="settings-item">
			<Button
				bind:this={trigger}
				type="button"
				aria-label={t('reader.controls')}
				aria-controls={controlsId}
				aria-expanded={open}
				onclick={ontoggle}
				appearance="flat"
			>
				<Icon icon={open ? CloseIcon : SettingsIcon} width="24" height="24" />
			</Button>
		</li>
	</TopNavigation>
</div>

<style>
	.reader-navigation {
		position: sticky;
		inset-block-start: 0;
		z-index: 3;
		--dui-button-border-width: 0;
	}

	.settings-item {
		margin-inline-start: auto;
	}
</style>
