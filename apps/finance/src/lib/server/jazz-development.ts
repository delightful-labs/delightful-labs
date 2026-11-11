import type { Jazz } from 'jazz-tools/backend'

// SvelteKit's SSR graph can reload independently of Vite's attached sockets.
// Retain only the SDK capability, never application data or workflow state.
const key = Symbol.for('delightful-finance.development-jazz')
export function developmentJazz(acquire: () => Jazz): Jazz {
	const existing: Jazz | undefined = Reflect.get(globalThis, key)
	if (existing) return existing
	const jazz = acquire()
	Reflect.set(globalThis, key, jazz)
	return jazz
}
export async function closeDevelopmentJazz(jazz: Jazz): Promise<void> {
	await jazz.close()
	if (Reflect.get(globalThis, key) === jazz) Reflect.deleteProperty(globalThis, key)
}
