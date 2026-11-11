import { createJazzSession } from 'jazz-tools'
import type { JazzSessionConfig } from 'jazz-tools/svelte'
import type { SessionOpenCapability } from '../../contracts/session.js'

/** Capture one configured backend leaf. The host creates/retains the acquisition owner in-browser. */
export function createJazzSessionAcquisition(config: JazzSessionConfig): Readonly<{
	binding: object
	capability: SessionOpenCapability<Awaited<ReturnType<typeof createJazzSession>>>
}> {
	const captured = { ...config }
	return {
		binding: Object.freeze({}),
		capability: { open: () => createJazzSession(captured) }
	}
}
