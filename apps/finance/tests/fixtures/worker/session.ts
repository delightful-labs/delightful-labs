import type { createJazzClient } from 'jazz-tools/client'
type Session = Awaited<ReturnType<typeof createJazzClient>>
let captured: Session | undefined
/** The exact native session constructed by the application; this fixture never constructs another. */
export function captureSession(session: Session) {
	captured = session
}
export function getCurrentJazzSession() {
	return captured
}
export const loadLocalFirstClient = () => import('jazz-tools/local-first')
