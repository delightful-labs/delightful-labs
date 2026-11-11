<script lang="ts">
	import { PaginationItem } from 'delightful-ui'
	import type { ComponentProps } from 'svelte'
	import AppLink from './AppLink.svelte'
	let { href, children, ...attributes }: ComponentProps<typeof PaginationItem> = $props()
</script>

{#if href == null || attributes.disabled || attributes.ellipsis}
	<PaginationItem {...attributes} {href}>{@render children?.()}</PaginationItem>
{:else}
	<AppLink {...attributes} {href} component={PaginationItem}>{@render children?.()}</AppLink>
{/if}
