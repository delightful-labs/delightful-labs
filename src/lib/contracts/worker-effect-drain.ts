import type { WorkerHostClosed } from './worker-channel.js'

/** A native acknowledgement or definitely-not-issued fact proves quiescence.
 * Observer timeout/rejection without such evidence remains uncertain. */
export type WorkerEffectSettlement = { kind: 'settled' } | { kind: 'uncertain' }
export type WorkerEffectProof =
	| { kind: 'settled' }
	| { kind: 'host-closed'; receipt: WorkerHostClosed }
export type WorkerEffectDrainInput = Readonly<{
	identity: WorkerHostClosed
	/** Receipts for the original effect only; never a capability to replay it. */
	settlement: Promise<WorkerEffectSettlement>
	hostClosed: Promise<WorkerHostClosed>
	requestClose: () => void
	deadlineMs?: number
	onOverdue: (identity: WorkerHostClosed) => void
}>
