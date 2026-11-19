import { bindWorkerConnectivity } from '../../offline/connectivity.js'
import { createActor, type ActorOptions } from 'xstate'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import { nativeSessionFixture } from '../../machines/runtime/session.test-support.js'
import { workerHostMachine } from './host-machine.js'

export function createWorkerHostFixture(
	acquisition?: Promise<void>,
	closeAccountStore?: () => Promise<WorkerHostClosed>,
	closeBroker?: () => Promise<WorkerHostClosed>,
	options?: {
		account?: ReturnType<typeof nativeSessionFixture>
		signOut?: () => Promise<void>
		clock?: ActorOptions<typeof workerHostMachine>['clock']
		closePolicy?: Partial<typeof import('./close-policy.js').REALM_CLOSE_POLICY>
	}
) {
	bindWorkerConnectivity(true)
	const native =
		options?.account ??
		nativeSessionFixture(undefined, {
			...(acquisition ? { acquisition } : {}),
			...(options?.clock ? { clock: options.clock } : {})
		})
	native.owner.start()
	return {
		close: native.close,
		owner: native.owner,
		actor: createActor(workerHostMachine, {
			...(options?.clock ? { clock: options.clock } : {}),
			input: {
				...native.input,
				scope: 'test-scope',
				...(options?.signOut ? { signOut: options.signOut } : {}),
				...(options?.closePolicy ? { closePolicy: options.closePolicy } : {}),
				...(closeAccountStore ? { closeAccountStore } : {}),
				...(closeBroker ? { closeBroker } : {})
			}
		})
	}
}
