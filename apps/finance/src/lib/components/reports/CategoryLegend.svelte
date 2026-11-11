<script lang="ts">
	import { Button } from 'delightful-ui'
	import { formatMoney } from '#lib/domain/money.js'
	import { getLocale } from '#lib/paraglide/runtime.js'
	let {
		items,
		selectedKey,
		currency,
		allLabel,
		onselect,
		onclear
	}: {
		items: readonly { key: string; label: string; value: number; color: string }[]
		selectedKey: string | null
		currency: string
		allLabel: string
		onselect: (key: string) => void
		onclear: () => void
	} = $props()
</script>

<Button aria-pressed={selectedKey === null} onclick={onclear}>{allLabel}</Button>
<ul class="legend">
	{#each items as slice (slice.key)}
		<li>
			<button
				type="button"
				aria-pressed={selectedKey === slice.key}
				onclick={() => onselect(slice.key)}
				><span class="swatch" style:background={slice.color}></span><span>{slice.label}</span><span
					class="amount">{formatMoney(slice.value, currency, getLocale())}</span
				></button
			>
		</li>
	{/each}
</ul>

<style>
	.legend {
		list-style: none;
		padding: 0;
	}
	button {
		display: flex;
		align-items: center;
		gap: var(--dui-spacing-xs);
		inline-size: 100%;
		padding: var(--dui-spacing-xs);
		font: inherit;
		color: inherit;
		background: none;
		border: 1px solid transparent;
		text-align: start;
		cursor: pointer;
	}
	button[aria-pressed='true'] {
		border-color: currentColor;
	}
	.amount {
		margin-inline-start: auto;
	}
	.swatch {
		inline-size: 1rem;
		block-size: 1rem;
		flex: none;
	}
</style>
