/** Component fixtures have no router; real navigation is exercised in Playwright. */
export function beforeNavigate(
	_callback: Parameters<typeof import('$app/navigation').beforeNavigate>[0]
) {}
