import { createActor, type ActorFromLogic } from 'xstate'
import { createJazzSessionRuntime } from 'delightful-local-first/backend/jazz/session-runtime'
import {
	createSessionRuntimeMachine,
	createSessionRuntimeConnection
} from 'delightful-local-first/session/runtime'
import { brokerHostClient } from 'delightful-local-first/backend/jazz/worker-broker'
import wasmUrl from '#jazz-wasm-binary?url'
import brokerUrl from '#jazz-broker-worker?sharedworker&url'
import sdk from 'jazz-tools/package.json' with { type: 'json' }
import {
	financeWorkerCommand,
	financeWorkerOpen,
	type FinanceWorkerCapabilities
} from '../../contracts/worker-application.js'
import {
	createFinanceWorkerMachine,
	selectFinanceArchiveObservation,
	selectFinanceArchiveWriter,
	selectFinanceFormObservations,
	selectFinanceWorkerView
} from '../../machines/runtime/worker-application.js'
import { createFinanceAccountStore } from './account-store.js'
import { createFinanceWorkerBinding } from './binding.js'

let application: ActorFromLogic<ReturnType<typeof createFinanceWorkerMachine>> | undefined
let viewScheduled = false
function publishView() {
	if (viewScheduled) return
	viewScheduled = true
	queueMicrotask(() => {
		viewScheduled = false
		if (!application) return
		try {
			self.postMessage(selectFinanceWorkerView(application.getSnapshot()))
		} catch {
			application.send({ type: 'NATIVE_FAILED' })
			self.postMessage({ type: 'FAILED' })
		}
	})
}
const sessionMachine = createSessionRuntimeMachine<FinanceWorkerCapabilities>()
self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const open = financeWorkerOpen.safeParse(event.data)
	if (open.success && !application && event.ports.length === 2) {
		const data = event.ports[0],
			control = event.ports[1]
		if (!data || !control) return
		try {
			const { serverUrl, scope, environment, hostId } = open.data
			const store = createFinanceAccountStore({
				serverUrl,
				scope,
				environment
			})
			const broker = brokerHostClient(data, control, hostId, {
				onOverdue: () => application?.send({ type: 'NATIVE_FAILED' }),
				onBlocked: () => application?.send({ type: 'NATIVE_FAILED' })
			})
			const native = createJazzSessionRuntime(
				{
					serverUrl,
					scope,
					env: environment,
					store,
					initial: 'device',
					runtimeSources: {
						wasmUrl,
						brokerWorkerUrl: brokerUrl,
						wasmVersion: sdk.version,
						browserWorkerHost: broker
					}
				},
				createFinanceWorkerBinding
			)
			const runtime = createActor(sessionMachine, { input: native })
			runtime.subscribe({
				error: () => application?.send({ type: 'NATIVE_FAILED' })
			})
			const machine = createFinanceWorkerMachine({
				observe: () => selectFinanceArchiveObservation(application?.getSnapshot()),
				observeForms: () => selectFinanceFormObservations(application?.getSnapshot()),
				persist: (request) => {
					const write = selectFinanceArchiveWriter(application?.getSnapshot(), request)
					return write
						? write(request.accountId)
						: Promise.reject(new Error('Finance archive binding retired'))
				}
			})
			application = createActor(machine, {
				input: {
					session: createSessionRuntimeConnection(runtime, native.binding),
					closeAccountStore: () => store.close(),
					closeBroker: () => broker.close(),
					brokerIdentity: broker.host.identity
				}
			})
			application.subscribe({
				next: publishView,
				error: () => self.postMessage({ type: 'FAILED' }),
				complete: () => {
					if (application?.getSnapshot().output?.outcome === 'closed')
						self.postMessage({ type: 'CLOSED' })
				}
			})
			application.start()
			runtime.start()
		} catch {
			self.postMessage({ type: 'FAILED' })
		}
		return
	}
	for (const port of event.ports) port.close()
	const command = financeWorkerCommand.safeParse(event.data)
	if (command.success) application?.send(command.data)
})
