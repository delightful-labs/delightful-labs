import { createLogger as createSharedLogger } from 'delightful-local-first/diagnostics/logger'

export type { DebugValue } from 'delightful-local-first/diagnostics/logger'

export const debugEnabled = import.meta.env.PUBLIC_DEBUG === 'true'

// Finance owns environment policy; DLF owns scoped output. Callers still select non-sensitive fields.
export function createLogger(scope: string) {
	return createSharedLogger(scope, { enabled: debugEnabled })
}
