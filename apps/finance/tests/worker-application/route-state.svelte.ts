// The standalone native-worker fixture supplies the SvelteKit page observation.
let url = $state.raw(new URL(location.href))
export const page = {
	get url() {
		return url
	},
	get params() {
		const id = url.pathname.match(/^\/(?:income|expenses)\/([^/]+)$/)?.[1]
		return id && id !== 'new' ? { id } : {}
	},
	shallow: undefined
}
export function observePage(location: URL) {
	url = location
}
