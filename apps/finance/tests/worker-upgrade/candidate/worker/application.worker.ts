import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import { parseJazzRecoveryPhrase } from 'delightful-local-first/backend/jazz/restoration'
import { replyWithRecoveryPhrase } from './recovery.js'
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
	financeRecoveryRead,
	financeIdentityRestore,
	financeWorkerOpen,
	type FinanceWorkerCapabilities
} from '../../contracts/worker-application.js'
import {
	createFinanceWorkerMachine,
	selectFinanceFormObservations,
	selectFinanceWorkerView,
	selectFinanceRestorationAdmission,
	selectFinanceRecoveryReader
} from '../../machines/runtime/worker-application.js'
import { createFinanceAccountStore } from './account-store.js'
import { createFinanceWorkerBinding } from './binding.js'

let application: ActorFromLogic<ReturnType<typeof createFinanceWorkerMachine>> | undefined
let restoration: ActorFromLogic<typeof restorationMachine> | undefined
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
	const restore = financeIdentityRestore.safeParse(event.data)
	if (restore.success) {
		for (const port of event.ports) port.close()
		const admitted = selectFinanceRestorationAdmission(
			application?.getSnapshot(),
			restore.data.sessionRevision
		)
		if (!admitted || !application || restoration?.getSnapshot().status === 'active') return
		const { session, scope } = admitted
		const current = (binding: object) =>
			binding === session.binding && session.view.get().stage === 'active'
		const owner = createActor(restorationMachine, {
			input: {
				scope,
				phrase: restore.data.phrase,
				reportTo: application,
				capability: {
					runtime: session,
					parsePhrase: parseJazzRecoveryPhrase,
					isCurrentBinding: current,
					readIdentity: async () => {
						const view = session.view.get(),
							observation = view.observation
						return view.stage === 'active' && observation?.status === 'ready'
							? { kind: 'ready', identityId: observation.identityId }
							: { kind: 'unavailable' }
					}
				}
			}
		})
		restoration = owner
		owner.subscribe({
			complete: () => {
				const result = owner.getSnapshot().output
				if (restoration === owner) restoration = undefined
				if (result)
					application?.send({ type: 'RESTORATION_FINISHED', result, view: session.view.get() })
			},
			error: () => {
				if (restoration === owner) restoration = undefined
				application?.send({ type: 'NATIVE_FAILED' })
			}
		})
		application.send({
			type: 'REGISTER_RESTORATION',
			scope,
			owner,
			sessionRevision: restore.data.sessionRevision
		})
		owner.start()
		return
	}
	const recovery = financeRecoveryRead.safeParse(event.data)
	if (recovery.success && event.ports.length === 1) {
		const reply = event.ports[0]
		if (reply)
			void replyWithRecoveryPhrase(
				reply,
				selectFinanceRecoveryReader(application?.getSnapshot(), recovery.data.sessionRevision)
			)
		return
	}
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
				observeForms: () => selectFinanceFormObservations(application?.getSnapshot())
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
