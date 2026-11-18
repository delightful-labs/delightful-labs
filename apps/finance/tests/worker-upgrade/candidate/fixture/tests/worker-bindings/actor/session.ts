import { sessionRecoveryMachine } from 'delightful-local-first/recovery/coordination'
import { createActor, waitFor } from 'xstate'
import {
	createJazzSessionRuntime,
	type JazzSessionBindingInput
} from 'delightful-local-first/backend/jazz/session-runtime'
import {
	createSessionRuntimeMachine,
	createSessionRuntimeConnection,
	createSessionChangeMachine,
	sessionCloseMachine,
	type SessionRuntimeChangeInput,
	selectSessionRuntimeObservation,
	type SessionRuntimeChangeReport,
	type SessionRuntimeIdentityChange
} from 'delightful-local-first/session/runtime'
import { createFinanceAccountStore } from '../../../src/lib/runtime/worker/account-store.js'
import { brokerHostClient } from 'delightful-local-first/backend/jazz/worker-broker'
import wasmUrl from '#jazz-wasm-binary?url'
import { app } from '../../../src/lib/schema.js'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import {
	createRecoveryPhraseMachine,
	selectRecoveryPhraseView
} from 'delightful-local-first/recovery/workflow'
import type { AvailableRecoveryScope } from 'delightful-local-first/recovery/contracts'

type Capabilities = {
	isCurrent: () => boolean
	read: () => Promise<number>
	recovery: JazzSessionBindingInput['recovery']
}
const sessionRuntimeMachine = createSessionRuntimeMachine<Capabilities>()

let broker: ReturnType<typeof brokerHostClient> | undefined
let actor: ReturnType<typeof createActor<typeof sessionRuntimeMachine>> | undefined
let store: ReturnType<typeof createFinanceAccountStore> | undefined
let held: ReturnType<typeof Promise.withResolvers<void>> | undefined
let changeHeld: ReturnType<typeof Promise.withResolvers<void>> | undefined
const reports: { attempt: number; outcome: SessionRuntimeChangeReport['outcome'] }[] = []
const command = createSessionChangeMachine<SessionRuntimeChangeInput>((input) => input)
let caller: ReturnType<typeof createActor<typeof command>> | undefined
let closing: ReturnType<typeof createActor<typeof sessionCloseMachine>> | undefined
let sessionBinding: object | undefined
let bound = 0
let capabilities: Capabilities | undefined
let originalCapabilities: Capabilities | undefined
let credential: string | undefined
let recoveryScope: AvailableRecoveryScope | undefined
let created = 0,
	restored = 0
let acquired = 0,
	subscribed = 0,
	unsubscribed = 0,
	closed = 0,
	actorFailed = false,
	signOutStarted = 0,
	signOutCompleted = 0
function owner() {
	if (!actor) throw new Error('Native session actor not open')
	return actor
}
function connection() {
	if (!sessionBinding) throw new Error('Session binding unavailable')
	return createSessionRuntimeConnection(owner(), sessionBinding)
}
function request(change: SessionRuntimeIdentityChange) {
	if (!sessionBinding || caller?.getSnapshot().status === 'active')
		throw new Error('Session command unavailable')
	caller?.stop()
	const attempt = reports.length + 1
	caller = createActor(command, {
		input: { session: connection(), scope: { binding: sessionBinding, attempt }, change }
	})
	caller.subscribe({
		complete: () => {
			const output = caller?.getSnapshot().output
			if (output) reports.push({ attempt, outcome: output.outcome })
		},
		error: () => {
			actorFailed = true
		}
	})
	caller.start()
}
function closeSession() {
	if (closing) return
	closing = createActor(sessionCloseMachine, { input: connection() })
	closing.subscribe({
		error: () => {
			actorFailed = true
		}
	})
	closing.start()
}
/** Actual worker/native session connection; navigation itself is a selected fixture leaf. */
async function qualifyRecoveryNavigation(identity: string) {
	let navigations = 0
	const before = { created, restored }
	const navigate = async () => {
		navigations += 1
		if (navigations === 1) throw new Error('Fixture navigation refusal')
	}
	const input = {
		attempt: 1,
		request: { kind: 'navigate', origin: '/from', destination: '/to', identity },
		session: connection(),
		restorationBinding: undefined,
		readHref: () => '/from',
		navigate
	} satisfies import('xstate').InputFrom<typeof sessionRecoveryMachine>
	const first = createActor(sessionRecoveryMachine, { input }).start()
	try {
		await waitFor(first, (s) => s.status === 'done')
		const result = first.getSnapshot().output
		if (result?.outcome !== 'navigationFailed' || !result.navigation)
			throw new Error('Recovery navigation failure not retained')
		const retry = createActor(sessionRecoveryMachine, {
			input: { ...input, attempt: 2, request: { kind: 'navigate', ...result.navigation } }
		}).start()
		try {
			await waitFor(retry, (s) => s.status === 'done')
			if (
				retry.getSnapshot().output?.outcome !== 'restored' ||
				navigations !== 2 ||
				before.created !== created ||
				before.restored !== restored
			)
				throw new Error('Recovery navigation retry repeated identity mutation')
		} finally {
			retry.stop()
		}
	} finally {
		first.stop()
	}
}
export const actorFixture = {
	open(
		initial: 'device' | 'signed-out',
		scope: string,
		brokerWorkerUrl: string,
		hold: boolean,
		data: MessagePort,
		control: MessagePort
	) {
		if (actor) throw new Error('Native session actor already open')
		broker = brokerHostClient(data, control, scope, {
			onOverdue: () => {
				actorFailed = true
			},
			onBlocked: () => {
				actorFailed = true
			}
		})
		const serverUrl = location.origin + '/jazz'
		const selected = createFinanceAccountStore({ serverUrl, scope, environment: 'actor-proof' })
		store = selected
		const native = createJazzSessionRuntime(
			{
				serverUrl,
				scope,
				env: 'actor-proof',
				store: selected,
				initial,
				runtimeSources: {
					wasmUrl,
					brokerWorkerUrl,
					wasmVersion: 'finance-sdk-proof-1',
					browserWorkerHost: broker
				}
			},
			({ db, isCurrent, recovery }) => {
				bound++
				capabilities = {
					isCurrent,
					recovery,
					read: async () => (await db.all(app.organizations, { tier: 'local-first' })).length
				}
				originalCapabilities ??= capabilities
				return capabilities
			}
		)
		sessionBinding = native.binding
		if (hold) held = Promise.withResolvers<void>()
		actor = createActor(sessionRuntimeMachine, {
			input: {
				...native,
				capability: {
					open: async () => {
						const resource = await native.capability.open()
						acquired++
						await held?.promise
						return {
							observe: (publish, failed) => {
								subscribed++
								const stop = resource.observe(publish, failed)
								return () => {
									stop()
									unsubscribed++
								}
							},
							changeIdentity: async (change) => {
								if (change.operation === 'signOut') signOutStarted++
								const outcome = await resource.changeIdentity(change)
								if (outcome === 'completed') {
									if (change.operation === 'signOut') signOutCompleted++
									if (change.operation === 'create') created++
									if (change.operation === 'restore') restored++
								}
								await changeHeld?.promise
								return outcome
							},
							close: async () => {
								await resource.close()
								closed++
							}
						}
					}
				}
			}
		})
		actor.subscribe({
			error: () => {
				actorFailed = true
			}
		})
		actor.start()
	},
	state() {
		const snapshot = owner().getSnapshot()
		const observation = selectSessionRuntimeObservation(snapshot)
		return {
			actorFailed,
			windowPresent: typeof window !== 'undefined',
			contextFrozen: Object.isFrozen(snapshot.context),
			failed: actorFailed || snapshot.matches('openFailed') || snapshot.matches('ownerFailed'),
			acquired,
			subscribed,
			unsubscribed,
			closed,
			created,
			restored,
			firstBindingCurrent: originalCapabilities?.isCurrent() ?? false,
			retiredRecoveryRejected:
				!!recoveryScope && !originalCapabilities?.recovery.capability.isCurrentScope(recoveryScope),
			bound,
			bindingCurrent: capabilities?.isCurrent() ?? false,
			signOutStarted,
			signOutCompleted,
			reports: [...reports],
			done: snapshot.status === 'done',
			clean:
				snapshot.output?.outcome === 'closed' &&
				closing?.getSnapshot().output?.outcome === 'closed',
			status: observation?.status,
			identityId: observation?.status === 'ready' ? observation.identityId : undefined,
			localFirst: observation?.status === 'ready' ? observation.localFirst : undefined
		}
	},
	async readBinding() {
		const observation = selectSessionRuntimeObservation(owner().getSnapshot())
		if (observation?.status !== 'ready') throw new Error('Binding unavailable')
		return observation.capabilities.read()
	},
	close() {
		closeSession()
	},
	signOut(stale: boolean, hold: boolean) {
		const observation = selectSessionRuntimeObservation(owner().getSnapshot())
		if (observation?.status !== 'ready' || !sessionBinding)
			throw new Error('Native session actor identity unavailable')
		if (hold) changeHeld = Promise.withResolvers<void>()
		request({
			operation: 'signOut',
			before: { status: 'ready', binding: stale ? {} : observation.binding }
		})
	},
	releaseChange() {
		changeHeld?.resolve()
	},
	releaseOpen() {
		held?.resolve()
	},
	createIdentity() {
		const observation = selectSessionRuntimeObservation(owner().getSnapshot())
		if (observation?.status !== 'signed-out') throw new Error('Fixture must be signed out')
		request({ operation: 'create', before: observation })
	},
	async recover() {
		const observation = selectSessionRuntimeObservation(owner().getSnapshot())
		if (observation?.status !== 'ready') throw new Error('Recovery binding unavailable')
		const binding = observation.capabilities.recovery
		const phrase = createActor(createRecoveryPhraseMachine(binding.capability), {
			input: { kind: 'unavailable' }
		}).start()
		const stop = binding.source.subscribe((scope) => phrase.send({ type: 'OBSERVE', scope }))
		try {
			phrase.send({ type: 'REVEAL' })
			await waitFor(phrase, (s) => selectRecoveryPhraseView(s).kind === 'revealed')
			const view = selectRecoveryPhraseView(phrase.getSnapshot()),
				scope = phrase.getSnapshot().context.scope
			if (view.kind !== 'revealed' || scope.kind !== 'available')
				throw new Error('Native recovery unavailable')
			credential = RecoveryPhrase.toSecret(view.phrase)
			recoveryScope = scope
			await qualifyRecoveryNavigation(observation.identityId)
			phrase.send({ type: 'HIDE' })
			return (
				selectRecoveryPhraseView(phrase.getSnapshot()).kind === 'hidden' &&
				phrase.getSnapshot().context.phrase === undefined
			)
		} finally {
			stop()
			phrase.send({ type: 'SHUTDOWN' })
			await waitFor(phrase, (s) => s.status === 'done')
			phrase.stop()
		}
	},
	restoreIdentity(hold: boolean) {
		const observation = selectSessionRuntimeObservation(owner().getSnapshot())
		if (!credential || (observation?.status !== 'ready' && observation?.status !== 'signed-out'))
			throw new Error('Restore binding unavailable')
		if (hold) changeHeld = Promise.withResolvers<void>()
		const key = credential
		credential = undefined
		request({
			operation: 'restore',
			before: { status: observation.status, binding: observation.binding },
			credential: key
		})
	},
	async dispose() {
		credential = undefined
		held?.resolve()
		changeHeld?.resolve()
		const current = owner()
		closeSession()
		if (!closing) throw new Error('Close invocation unavailable')
		await waitFor(closing, (snapshot) => snapshot.status === 'done', { timeout: 5000 })
		if (closing.getSnapshot().output?.outcome !== 'closed')
			throw new Error('Close invocation failed')
		await waitFor(current, (snapshot) => snapshot.status === 'done', { timeout: 5000 })
		if (current.getSnapshot().output?.outcome !== 'closed')
			throw new Error('Native session close failed')
		await store?.close()
		if (!broker) throw new Error('Actor broker missing')
		const receipt = await broker.close()
		const hostClosed =
			receipt.scope === broker.host.identity.scope &&
			receipt.requestId === broker.host.identity.requestId
		if (!hostClosed) throw new Error('Actor broker close receipt mismatch')
		actor = undefined
		store = undefined
		held = undefined
		broker = undefined
		caller?.stop()
		closing?.stop()
		closing = undefined
		return { sdkClosed: true, storeClosed: true, hostClosed }
	}
}
