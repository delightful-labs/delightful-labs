<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import ChevronRight from 'tdesign-icons-svg/src/chevron-right.svg?component'
	import Icon from './Icon.svelte'

	let {
		label,
		children,
		trailing,
		class: className,
		...attributes
	}: Omit<
		HTMLAnchorAttributes,
		'children' | 'href' | 'aria-label' | 'aria-labelledby'
	> & {
		href: string
		/** Translated, descriptive accessible name for the destination. */
		label: string
		/** Non-interactive row content. Do not include links or form controls. */
		children: Snippet
		/** Optional non-interactive metadata, such as an amount or reading progress. */
		trailing?: Snippet
	} = $props()
</script>

<li class="linked-list-row">
	<a
		{...attributes}
		aria-label={label}
		class={['row-link', className]}
		class:with-trailing={Boolean(trailing)}
	>
		<div class="content">{@render children()}</div>
		{#if trailing}<div class="trailing">{@render trailing()}</div>{/if}
		<span class="indicator"><Icon icon={ChevronRight} /></span>
	</a>
</li>

<style>
	.linked-list-row {
		min-inline-size: 0;
		list-style: none;
	}

	.row-link {
		--dui-text-color: currentColor;
		box-sizing: border-box;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		gap: var(
			--dui-linked-list-row-gap,
			var(--dui-spacing-xs, 0.5rem) var(--dui-spacing-md, 1rem)
		);
		padding: var(--dui-linked-list-row-padding, var(--dui-spacing-xs, 0.5rem));
		font-size: var(
			--dui-linked-list-row-font-size,
			var(--dui-font-size-sm, 0.875rem)
		);
		color: inherit;
		text-decoration: none;
	}

	.with-trailing {
		grid-template-columns: minmax(0, 1fr) auto auto;
	}

	.content {
		display: grid;
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.trailing {
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.indicator {
		display: inline-flex;
		align-self: start;
		align-items: center;
		justify-content: center;
		min-inline-size: 24px;
		min-block-size: 24px;
	}

	.row-link:hover {
		color: var(--dui-color-on-accent, #262626);
		background-color: var(--dui-color-accent, #94ff47);
	}

	.row-link:focus-visible {
		outline: 2px solid var(--dui-color-focus, currentColor);
		outline-offset: 2px;
	}
</style>
