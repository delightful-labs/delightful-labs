<script lang="ts">
	import type { Component } from 'svelte'
	import type { SVGAttributes } from 'svelte/elements'
	import LoadingSpinner from './LoadingSpinner.svelte'
	import Icon from './Icon.svelte'

	let {
		icon,
		text,
		loading = false
	}: {
		icon: Component<SVGAttributes<SVGSVGElement>>
		text: string
		loading?: boolean
	} = $props()
</script>

<span class="button-content">
	<span class="indicator" aria-hidden="true">
		{#if loading}
			<LoadingSpinner role="presentation" />
		{:else}
			<Icon {icon} width="100%" height="100%" />
		{/if}
	</span>
	<span>{text}</span>
</span>

<style>
	@property --dui-button-content-gap {
		syntax: '<length>';
		inherits: true;
		initial-value: 8px;
	}

	@property --dui-button-content-icon-size {
		syntax: '<length>';
		inherits: true;
		initial-value: 16px;
	}

	@property --dui-button-content-spinner-border-width {
		syntax: '<length>';
		inherits: true;
		initial-value: 2px;
	}

	.button-content {
		display: inline-flex;
		align-items: center;
		gap: var(
			--dui-button-content-gap,
			var(--dui-space-xs, var(--dui-spacing-xs, 0.5rem))
		);
	}

	.indicator {
		--dui-loading-spinner-size: 100%;
		--dui-loading-spinner-border-width: var(
			--dui-button-content-spinner-border-width,
			2px
		);
		display: inline-flex;
		flex: none;
		inline-size: var(--dui-button-content-icon-size, 1em);
		block-size: var(--dui-button-content-icon-size, 1em);
	}
</style>
