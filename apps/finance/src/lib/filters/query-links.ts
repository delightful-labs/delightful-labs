export const queryLinksKey = Symbol('query-links')

export type QueryLinkContext = {
	readonly href: string | undefined
	readonly keys: readonly string[]
}
