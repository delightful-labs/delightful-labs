import type { AccountStoreStorage } from '../../machines/runtime/account-store-contracts.js'
import type { createWorkerHostClient } from './host-client.js'
import type { createWorkerHostDrain } from './host-drain.js'

/** Bind native capabilities only. The worker root owns these channels and must
 * forward the drain's onClosed callback to its account-store owner actor. */
export function bindWorkerAccountStorage(
	client: ReturnType<typeof createWorkerHostClient>,
	drain: ReturnType<typeof createWorkerHostDrain>
): AccountStoreStorage {
	if (client.scope !== drain.scope) throw new Error('Mismatched worker storage scope')
	return {
		scope: client.scope,
		readSnapshot: client.accountStorage.readSnapshot,
		writePrimary: client.accountStorage.write,
		readEarlier: client.accountStorage.readEarlier,
		writeEarlier: client.accountStorage.writeEarlier,
		closeHostAndDrain: drain.closeHostAndDrain
	}
}
