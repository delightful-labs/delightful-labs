<script lang="ts">
	import type { Snippet } from 'svelte'
	import { Button, Popover, ScreenReaderText } from 'delightful-ui'
	import Icon from '../navigation/AppIcon.svelte'
	import SearchIcon from 'tdesign-icons-svg/src/search.svg?component'
	import FilterIcon from 'tdesign-icons-svg/src/filter.svg?component'
	import { m } from '#lib/paraglide/messages.js'

	let {
		search,
		filters,
		trailing
	}: { search: Snippet; filters: Snippet; trailing?: Snippet | undefined } = $props()
	const id = $props.id()

	function dismissPopover(event: KeyboardEvent) {
		if (event.key !== 'Escape' || !(event.currentTarget instanceof HTMLElement)) return
		event.preventDefault()
		event.stopPropagation()
		event.currentTarget.hidePopover()
		document.getElementById(`${event.currentTarget.id}-trigger`)?.focus()
	}
</script>

<div class="filter-actions">
	<Button id={`${id}-search-trigger`} type="button" popovertarget={`${id}-search`}>
		<Icon icon={SearchIcon} />
		<ScreenReaderText
			>{m['actions.search_subject']({
				subject: m['nouns.transaction']({ count: 2 })
			})}</ScreenReaderText
		>
	</Button>
	<Popover id={`${id}-search`} onkeydown={dismissPopover}
		><div class="fields">{@render search()}</div></Popover
	>
	<Button id={`${id}-filters-trigger`} type="button" popovertarget={`${id}-filters`}>
		<Icon icon={FilterIcon} />
		<ScreenReaderText
			>{m['actions.filter_subject']({
				subject: m['nouns.transaction']({ count: 2 })
			})}</ScreenReaderText
		>
	</Button>
	<Popover id={`${id}-filters`} onkeydown={dismissPopover}
		><div class="fields">{@render filters()}</div></Popover
	>
	{@render trailing?.()}
</div>

<style>
	.filter-actions {
		display: flex;
		gap: var(--dui-spacing-xs);
		margin-inline-start: auto;
		flex-shrink: 0;
	}
	.filter-actions > :global(button) {
		--dui-button-padding: var(--dui-spacing-xs, 0.5rem);
		inline-size: var(--dui-button-min-height, 44px);
		block-size: var(--dui-button-min-height, 44px);
		display: grid;
		place-items: center;
	}
	.fields {
		display: grid;
		gap: var(--dui-spacing-md);
		min-inline-size: 0;
	}
</style>
