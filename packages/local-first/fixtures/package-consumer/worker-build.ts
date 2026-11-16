import type { UserConfig } from 'vite'
import { jazzWorkerOptions } from 'delightful-local-first/backend/jazz/worker-build'

export function workerBuild() {
	return jazzWorkerOptions() satisfies NonNullable<UserConfig['worker']>
}
