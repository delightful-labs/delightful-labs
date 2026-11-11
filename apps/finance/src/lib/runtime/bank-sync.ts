import { getContext, type Snippet } from 'svelte'
import type { Readable } from 'svelte/store'
import type { BankStatus, LastSync } from '#lib/machines/bank-sync/types.js'
import type { createApplicationReadinessMachine } from '#lib/machines/runtime/application-readiness.js'
import type { createBankSyncMachine } from '#lib/machines/bank-sync/index.js'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'

export type {
	BankEvent as BankSyncEvent,
	BankCommand as BankSyncCommand
} from '#lib/machines/bank-sync/index.js'
type BankSyncMachine = ReturnType<typeof createBankSyncMachine>
export type BankSyncSnapshot = SnapshotFrom<BankSyncMachine>
export type BankSyncActor = ActorRefFrom<BankSyncMachine>

export type BankSyncControls = {
	actor: BankSyncActor | undefined
	snapshot: Readable<BankSyncSnapshot | undefined>
	status: BankStatus | undefined
	outcome: LastSync | undefined
	visible: boolean
	disabled: boolean
	loading: boolean
	sync: () => void
}

export type BankSyncContext = BankSyncControls & {
	view: Snippet
}

export const bankSyncKey = Symbol('bank-sync')

// One actor per application tree, never a process-wide SSR singleton.
export function getBankSync() {
	return getContext<BankSyncContext>(bankSyncKey)
}

export type ReadinessActor = ActorRefFrom<ReturnType<typeof createApplicationReadinessMachine>>
export type ReadinessSnapshot = SnapshotFrom<ReturnType<typeof createApplicationReadinessMachine>>
export const readinessKey = Symbol('readiness')
export type ReadinessContext = {
	actor: ReadinessActor
	snapshot: Readable<ReadinessSnapshot>
}

export function getReadiness() {
	return getContext<ReadinessContext>(readinessKey)
}
