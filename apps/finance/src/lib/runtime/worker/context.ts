import { createContext } from 'svelte'
import type { createFinanceWorkerClient } from './client.js'

export type FinanceWorkerClient = ReturnType<typeof createFinanceWorkerClient>

/** The root layout owns transport; pages bind its existing client after browser mounting. */
export const [getFinanceWorker, setFinanceWorker] = createContext<{
	readonly client: FinanceWorkerClient
}>()
