import type { AccountStore } from 'jazz-tools'
import type { accountStoreOwnerMachine } from '../../machines/runtime/account-store-owner.js'
import type { AccountStoreRequest } from '../../machines/runtime/account-store-contracts.js'
import type { AccountStoreResponse } from '../../machines/runtime/account-store-owner-contracts.js'
import { WorkerHostError } from './host-protocol.js'
import type { ActorRefFrom } from 'xstate'

function failure(result: AccountStoreResponse) {
	if (result.kind === 'unavailable') return new WorkerHostError(result.reason, 'not-issued')
	if (result.kind === 'failed') return new WorkerHostError('unavailable', result.writeOutcome)
	if (result.kind === 'canceled') return new WorkerHostError('closed', 'not-issued')
	return new WorkerHostError('invalid-reply', 'unknown')
}
/** Bind the SDK to an already-owned actor. This boundary starts no actor and
 * performs no storage, identity selection, queuing or transform retry itself. */
export function createWorkerAccountStore(
	owner: ActorRefFrom<typeof accountStoreOwnerMachine>
): AccountStore {
	const request = (value: AccountStoreRequest) =>
		new Promise<AccountStoreResponse>((resolve, reject) => {
			if (owner.getSnapshot().status !== 'active') {
				reject(new WorkerHostError('closed', 'not-issued'))
				return
			}
			owner.send({ type: 'REQUEST', request: value, respond: resolve })
		})
	return {
		async read() {
			const result = await request({ kind: 'read' })
			if (result.kind !== 'read') throw failure(result)
			return result.value
		},
		async update(transform) {
			const result = await request({ kind: 'update', transform })
			if (result.kind !== 'updated') throw failure(result)
		}
	}
}
