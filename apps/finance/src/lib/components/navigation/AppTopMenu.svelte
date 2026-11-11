<script lang="ts">
	import { Button, ScreenReaderText } from 'delightful-ui'
	import Icon from './AppIcon.svelte'
	import MenuIcon from 'tdesign-icons-svg/src/menu-fold.svg?component'
	import CloseIcon from 'tdesign-icons-svg/src/close.svg?component'
	import { m } from '#lib/paraglide/messages.js'

	let {
		drawerId,
		toggleId,
		drawerOpen,
		onToggle
	}: {
		drawerId: string
		toggleId: string
		drawerOpen: boolean
		onToggle: () => void
	} = $props()
</script>

<Button
	class="navigation-toggle"
	id={toggleId}
	type="button"
	aria-controls={drawerId}
	aria-expanded={drawerOpen}
	onclick={onToggle}
>
	<ScreenReaderText
		>{m['actions.toggle_subject']({ subject: m['navigation.label']() })}</ScreenReaderText
	>
	<Icon icon={drawerOpen ? CloseIcon : MenuIcon} />
</Button>

<style>
	:global(.navigation-toggle) {
		--dui-button-padding: var(--dui-spacing-xs, 0.5rem);
		--dui-button-min-height: var(--app-navigation-size, 2.75rem);
		inline-size: var(--app-navigation-size, 2.75rem);
		block-size: var(--app-navigation-size, 2.75rem);
		flex-shrink: 0;
		display: grid;
		place-items: center;
		touch-action: manipulation;
	}
</style>
