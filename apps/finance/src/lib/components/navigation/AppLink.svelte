<script lang="ts" generics="Extra extends Record<string, unknown> = Record<never, never>">
	import { getContext, type Component, type Snippet } from 'svelte'
	import type { HTMLAnchorAttributes } from 'svelte/elements'
	import { queryLinksKey, type QueryLinkContext } from '#lib/filters/query-links.js'
	import { inheritedQueryHref, type QueryUpdates } from '#lib/domain/query-params.js'
	import Anchor from './Anchor.svelte'

	type Props = Omit<HTMLAnchorAttributes, 'href' | 'children'> &
		Extra & {
			href: string
			query?: QueryUpdates
			inheritParams?: readonly string[] | false
			component?: Component<
				Omit<Props, 'component' | 'query' | 'inheritParams' | 'href' | 'children'> & {
					href: string
					children: Snippet
				}
			>
			children?: Snippet
		}

	const context = getContext<QueryLinkContext | undefined>(queryLinksKey)
	let {
		href,
		query = {},
		inheritParams,
		component: LinkComponent = Anchor,
		children,
		...attributes
	}: Props = $props()
	const keys = $derived(
		inheritParams === false || (attributes.download != null && attributes.download !== false)
			? []
			: (inheritParams ?? context?.keys ?? [])
	)
	const destination = $derived(inheritedQueryHref(href, context?.href, keys, query))
</script>

<LinkComponent {...attributes} href={destination}>{@render children?.()}</LinkComponent>
