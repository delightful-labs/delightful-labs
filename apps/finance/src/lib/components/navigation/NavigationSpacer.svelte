<script lang="ts">
	let { collapsed = false, gap = '0px' }: { collapsed?: boolean; gap?: string } = $props()
</script>

<div
	class="navigation-spacer"
	data-collapsed={collapsed}
	style:--navigation-spacer-gap={gap}
	aria-hidden="true"
></div>

<style>
	.navigation-spacer {
		inline-size: calc(var(--app-navigation-size, 2.75rem) + var(--navigation-spacer-gap));
		block-size: var(--app-navigation-size, 2.75rem);
		flex-shrink: 0;
		transition: inline-size var(--dui-drawer-duration, 225ms);
	}

	.navigation-spacer[data-collapsed='true'] {
		inline-size: 0;
	}

	@media (prefers-reduced-motion: reduce) {
		.navigation-spacer {
			transition: none;
		}
	}
</style>
