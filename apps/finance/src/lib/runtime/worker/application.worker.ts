import { clearAtprotoAppSession } from 'delightful-local-first/auth/atproto/workflow'
import { debugEnabled } from '../../diagnostics/logger.js'
import { projectInspection } from '../../diagnostics/inspection-projection.js'
import { logMachineFailure } from '../../diagnostics/machine-diagnostics.js'
import type { InspectionEvent } from 'xstate'
function inspect(event: InspectionEvent) {
	if (!debugEnabled) return
	logMachineFailure(event)
	const projected = projectInspection(event)
	if (projected) self.postMessage({ type: 'INSPECTION', event: projected })
}
import { financeBankConnectRequest } from '../../contracts/worker-banks.js'
import { selectFinanceBankAdmission } from '../../machines/runtime/worker-application.js'
import {
	financeBackupRequest,
	financeWorkspaceRestoreRequest
} from '../../contracts/worker-backup.js'
import { prepareBackupSubmission } from '../../backup/submission.js'
import { sessionRecoveryMachine } from 'delightful-local-first/recovery/coordination'
import { requestWindowNavigation, requestProviderNavigation } from './navigation.js'
import type { RecoveryRequest } from 'delightful-local-first/recovery/coordination'
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
	financeRecoveryRetry,
	financeWorkerOpen,
	type FinanceWorkerCapabilities
} from '../../contracts/worker-application.js'
import {
	createFinanceWorkerMachine,
	selectFinanceFormObservations,
	selectFinanceWorkerView,
	selectFinanceRestorationAdmission,
	selectFinanceNavigationRetry,
	selectFinanceRecoveryReader,
	selectFinanceBackupAdmission
} from '../../machines/runtime/worker-application.js'
import { createFinanceAccountStore, financeAccountStoreBinding } from './account-store.js'
import { createFinanceAccountOrderStorage } from './account-order-store.js'
import { createFinanceWorkerBinding } from './binding.js'

let application: ActorFromLogic<ReturnType<typeof createFinanceWorkerMachine>> | undefined
let restoration: ActorFromLogic<typeof sessionRecoveryMachine> | undefined
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
	const bankConnect = financeBankConnectRequest.safeParse(event.data)
	if (bankConnect.success) {
		for (const port of event.ports) port.close()
		const owner = selectFinanceBankAdmission(application?.getSnapshot(), bankConnect.data)
		owner?.send({ type: 'BANK', event: { type: 'CONNECT', token: bankConnect.data.token } })
		return
	}
	const backup = financeBackupRequest.safeParse(event.data)
	const importFile = financeWorkspaceRestoreRequest.safeParse(event.data)
	if (backup.success || importFile.success) {
		for (const port of event.ports) port.close()
		const request = backup.success ? backup.data : importFile.success ? importFile.data : undefined
		if (!request || !application) return
		const admitted = selectFinanceBackupAdmission(application.getSnapshot(), request)
		if (!admitted) return
		try {
			if (backup.success)
				application.send({
					type: 'START_BACKUP',
					sessionRevision: backup.data.sessionRevision,
					selection: backup.data.selection,
					submission: prepareBackupSubmission(backup.data.protection, backup.data.password)
				})
			else if (importFile.success)
				application.send({
					type: 'START_WORKSPACE_RESTORE',
					sessionRevision: importFile.data.sessionRevision,
					selection: importFile.data.selection,
					request: admitted.prepareWorkspaceRestore(importFile.data.file, importFile.data.password)
				})
		} catch {
			application.send({ type: 'NATIVE_FAILED' })
		}
		return
	}
	const restore = financeIdentityRestore.safeParse(event.data),
		retry = financeRecoveryRetry.safeParse(event.data)
	if (restore.success || retry.success) {
		for (const port of event.ports) port.close()
		const revision = restore.success
			? restore.data.sessionRevision
			: retry.success
				? retry.data.sessionRevision
				: -1
		const navigation = retry.success
			? selectFinanceNavigationRetry(application?.getSnapshot(), revision)
			: undefined
		const admitted = restore.success
			? selectFinanceRestorationAdmission(application?.getSnapshot(), revision)
			: navigation
		const request: RecoveryRequest | undefined = restore.success
			? {
					kind: 'restore',
					phrase: restore.data.phrase,
					origin: restore.data.origin,
					destination: '/'
				}
			: navigation
				? { kind: 'navigate', ...navigation.navigation }
				: undefined
		if (!admitted || !request || !application || restoration?.getSnapshot().status === 'active')
			return
		const { session, scope } = admitted
		const current = (binding: object) =>
			binding === session.binding && session.view.get().stage === 'active'
		const owner = createActor(sessionRecoveryMachine, {
			inspect,
			input: {
				attempt: scope.attempt,
				request,
				session,
				reportTo: application,
				readHref: () => application?.getSnapshot().context.href ?? request.origin,
				navigate: (destination) => requestWindowNavigation(destination, request.origin),
				restorationBinding: {
					binding: scope.binding,
					invalidate: () => {},
					capability: {
						runtime: session,
						...(admitted.needsProviderClearance
							? { clearProviderSession: clearAtprotoAppSession }
							: {}),
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
			}
		})
		restoration = owner
		owner.subscribe({
			complete: () => {
				if (restoration === owner) restoration = undefined
				const result = owner.getSnapshot().output
				if (result)
					application?.send({
						type: 'RESTORATION_FINISHED',
						scope,
						result,
						view: session.view.get()
					})
				else application?.send({ type: 'RESTORATION_FAILED', ...scope })
			},
			error: () => {
				if (restoration === owner) restoration = undefined
				application?.send({ type: 'RESTORATION_FAILED', ...scope })
			}
		})
		application.send({
			type: 'REGISTER_RESTORATION',
			scope,
			owner,
			operation: request.kind,
			sessionRevision: revision
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
			const runtime = createActor(sessionMachine, {
				inspect,
				input: native
			})
			runtime.subscribe({
				error: () => application?.send({ type: 'NATIVE_FAILED' })
			})
			const machine = createFinanceWorkerMachine({
				observeForms: () => selectFinanceFormObservations(application?.getSnapshot())
			})
			application = createActor(machine, {
				inspect,
				input: {
					session: createSessionRuntimeConnection(runtime, native.binding),
					callbackAttempt: open.data.callbackAttempt,
					navigateProvider: requestProviderNavigation,
					clearAppSession: clearAtprotoAppSession,
					authReturned: () => self.postMessage({ type: 'AUTH_RETURNED' }),
					accountOrderStorage: createFinanceAccountOrderStorage(
						financeAccountStoreBinding({ serverUrl, scope, environment }).key
					),
					closeAccountStore: () => store.close(),
					closeBroker: () => broker.close(),
					brokerIdentity: broker.host.identity,
					navigate: (destination, signal, origin, replace) => {
						signal.throwIfAborted()
						return requestWindowNavigation(destination, origin, replace)
					}
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
