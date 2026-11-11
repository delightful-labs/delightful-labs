export type OverviewFilters = {
	start: string
	end: string
	categoryId: string | null
	currency: string
}

export function loadOverviewFilters(key: string): OverviewFilters | null {
	const stored = sessionStorage.getItem(key)
	if (!stored) return null
	try {
		const value: unknown = JSON.parse(stored)
		if (
			typeof value === 'object' &&
			value !== null &&
			typeof Reflect.get(value, 'start') === 'string' &&
			typeof Reflect.get(value, 'end') === 'string' &&
			(Reflect.get(value, 'categoryId') === null ||
				typeof Reflect.get(value, 'categoryId') === 'string') &&
			typeof Reflect.get(value, 'currency') === 'string'
		) {
			return {
				start: Reflect.get(value, 'start'),
				end: Reflect.get(value, 'end'),
				categoryId: Reflect.get(value, 'categoryId'),
				currency: Reflect.get(value, 'currency')
			}
		}
	} catch {
		sessionStorage.removeItem(key)
	}
	return null
}

export function saveOverviewFilters(key: string, value: OverviewFilters | null) {
	if (value) sessionStorage.setItem(key, JSON.stringify(value))
}
