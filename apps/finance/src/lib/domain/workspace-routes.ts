import { z } from 'zod'

import { queryParameterValues, withQueryParams } from './query-params.js'

/** Query scope is explicit even when malformed; it never establishes authorization. */
export function workspaceRoute(search: string) {
	const values = queryParameterValues(search, 'workspace')
	const requestedId = values[0]
	return {
		requestedId,
		workspaceId:
			values.length === 1 && z.uuid().safeParse(requestedId).success
				? (requestedId?.toLowerCase() ?? null)
				: null,
		scoped: values.length > 0
	}
}

export function workspaceHref(workspaceId: string | null, href = '/') {
	return withQueryParams(href, { workspace: workspaceId })
}

export function switchedWorkspaceHref(
	workspaceId: string,
	pathname: string,
	search = '',
	hash = ''
) {
	const safePath = pathname.replace(/^\/(expenses|income)\/[^/]+$/, '/$1')
	return withQueryParams(`${safePath}${search}${safePath === pathname ? hash : ''}`, {
		workspace: workspaceId,
		page: null
	})
}

export function workspaceLabel(
	workspace: { id: string; name: string },
	workspaces: readonly { name: string }[]
) {
	return workspaces.filter((row) => row.name === workspace.name).length > 1
		? `${workspace.name} · ${workspace.id}`
		: workspace.name
}
