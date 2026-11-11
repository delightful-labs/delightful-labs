<script lang="ts">
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import ChevronRight from 'tdesign-icons-svg/src/chevron-right.svg?component'
	import { Icon } from 'delightful-ui'

	let {
		href,
		...attributes
	}: Omit<HTMLAnchorAttributes, 'href'> & {
		href: string
	} = $props()
</script>

<a {...attributes} {href}>{@render attributes.children?.()} <Icon icon={ChevronRight} /></a>

<style>
	a::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		z-index: 1;
		inline-size: 100%;
		block-size: 100%;
	}
</style>
