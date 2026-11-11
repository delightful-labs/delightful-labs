<script lang="ts">
	import type { ComponentProps } from 'svelte'
	import AppLink from '#lib/components/navigation/AppLink.svelte'

	import { NavigationLink } from 'delightful-ui'

	let {
		href,
		pathname,
		label,
		...attributes
	}: Omit<ComponentProps<typeof NavigationLink>, 'href' | 'children'> & {
		label: string
		pathname: string
		href: string
	} = $props()

	const current = $derived(
		pathname.replace(/\/$/, '') === href.split(/[?#]/)[0]?.replace(/\/$/, '') ? 'page' : undefined
	)
</script>

<AppLink {...attributes} {href} component={NavigationLink} aria-current={current}>{label}</AppLink>
