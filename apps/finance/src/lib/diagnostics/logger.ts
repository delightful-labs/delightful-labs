import { PUBLIC_DEBUG } from '$app/env/public'
import { createLogger as createSharedLogger } from 'delightful-local-first/diagnostics/logger'

export type { DebugValue } from 'delightful-local-first/diagnostics/logger'

export const debugEnabled = PUBLIC_DEBUG === 'true'

// Finance owns environment policy; DLF owns scoped output. Callers still select non-sensitive fields.
export function createLogger(scope: string) {
	return createSharedLogger(scope, { enabled: debugEnabled })
}
