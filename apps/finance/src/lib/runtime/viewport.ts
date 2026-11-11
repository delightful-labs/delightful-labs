/** Call in the browser, for example inside onMount or an event handler. */
export function isMobile(): boolean {
	return window.matchMedia('(max-width: 48rem)').matches
}
