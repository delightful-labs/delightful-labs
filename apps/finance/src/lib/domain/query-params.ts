type QueryScalar = string | number | boolean
export type QueryValue = QueryScalar | readonly QueryScalar[] | null | undefined
export type QueryUpdates = Readonly<Record<string, QueryValue>>

export function queryParameterValues(search: string, name: string): string[] {
	return new URLSearchParams(search).getAll(name)
}

/** Update arbitrary query parameters without losing the URL path, other parameters or fragment. */
export function withQueryParams(href: string, updates: QueryUpdates): string {
	if (Object.keys(updates).length === 0) return href
	const hashIndex = href.indexOf('#')
	const fragment = hashIndex < 0 ? '' : href.slice(hashIndex)
	const base = hashIndex < 0 ? href : href.slice(0, hashIndex)
	const queryIndex = base.indexOf('?')
	const path = queryIndex < 0 ? base : base.slice(0, queryIndex)
	const params = new URLSearchParams(queryIndex < 0 ? '' : base.slice(queryIndex + 1))
	for (const [name, value] of Object.entries(updates)) {
		if (value == null) params.delete(name)
		else if (Array.isArray(value)) {
			params.delete(name)
			for (const item of value) params.append(name, String(item))
		} else params.set(name, String(value))
	}
	return `${path}${params.size ? `?${params}` : ''}${fragment}`
}

/** Inherit selected query keys for internal links, without changing explicit destination values. */
export function inheritedQueryHref(
	href: string,
	currentHref: string | undefined,
	keys: readonly string[],
	updates: QueryUpdates = {}
): string {
	if (!currentHref || keys.length === 0 || href.startsWith('#'))
		return withQueryParams(href, updates)
	let source: URL
	let destination: URL
	try {
		source = new URL(currentHref)
		destination = new URL(href, source)
	} catch {
		return withQueryParams(href, updates)
	}
	if (destination.origin !== source.origin || !['http:', 'https:'].includes(destination.protocol)) {
		return withQueryParams(href, updates)
	}
	const inherited = Object.fromEntries(
		keys
			.filter((key) => !destination.searchParams.has(key) && source.searchParams.has(key))
			.map((key) => [key, source.searchParams.getAll(key)])
	)
	return withQueryParams(withQueryParams(href, inherited), updates)
}
