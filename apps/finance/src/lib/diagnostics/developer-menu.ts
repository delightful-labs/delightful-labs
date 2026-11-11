export type SampleControls = {
	busy: boolean
	saved: number
	failed: boolean
	onadd: () => void
}
export type DeveloperMenuContent = { income: SampleControls; expense: SampleControls }
export function unavailableSampleControls(): SampleControls {
	return { busy: true, saved: 0, failed: false, onadd: () => {} }
}
export const developerMenuKey = Symbol('developer-menu')
