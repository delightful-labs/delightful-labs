import { createJazzClient } from 'jazz-tools/client'
import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'
import { createSessionAcquisitionMachine } from 'delightful-local-first/session/workflow'
import { createWorkerChannel } from 'delightful-local-first/worker/channel/workflow'
import { createWorkerEffectDrain } from 'delightful-local-first/worker/effect-drain/workflow'
import { brokerHostClient } from 'delightful-local-first/backend/jazz/worker-broker'
import { createFinanceAccountStore } from './account-store.js'

// W02 build-only entry: no production caller, session, actor, port or storage owner.
// Keeping factory values in this diagnostic catalog prevents an empty-worker proof.
const factories = {
	createJazzClient,
	createJazzSessionAcquisition,
	createJazzStartupRegistry,
	createSessionAcquisitionMachine,
	createWorkerChannel,
	createWorkerEffectDrain,
	brokerHostClient,
	createFinanceAccountStore,
	loadLocalFirstClient: () => import('jazz-tools/local-first')
}

// The isolated proof driver is never invoked automatically. If opened manually,
// this entry reports import kinds only; it never calls a factory or opens the SDK.
self.postMessage({
	type: 'FINANCE_WORKER_IMPORTS',
	factories: Object.fromEntries(
		Object.entries(factories).map(([name, factory]) => [name, typeof factory])
	)
})
