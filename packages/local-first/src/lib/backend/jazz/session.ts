import { createJazzClient } from 'jazz-tools/client'
import type { JazzClientConfig } from 'jazz-tools/client'
import type { SessionOpenCapability } from '../../contracts/session.js'

/** Capture one configured backend leaf. The host creates/retains the acquisition owner in-browser. */
export function createJazzSessionAcquisition(config: JazzClientConfig): Readonly<{
	binding: object
	capability: SessionOpenCapability<Awaited<ReturnType<typeof createJazzClient>>>
}> {
	const captured = { ...config }
	return {
		binding: Object.freeze({}),
		capability: { open: () => createJazzClient(captured) }
	}
}
