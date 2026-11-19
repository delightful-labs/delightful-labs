import { createJazzClient } from 'jazz-tools/client'
import { createJazzRecoveryAdapter } from './recovery-phrase.js'
import type {
	RecoveryPhraseCapability,
	RecoveryScopeSource
} from '../../contracts/recovery-phrase.js'
import type { JazzClient, JazzClientConfig, JazzSessionSnapshot } from 'jazz-tools/client'
import type {
	SessionRuntimeInput,
	SessionRuntimeObservation
} from '../../contracts/session-runtime.js'

const loadLocalFirstClient = () => import('jazz-tools/local-first')

/** Native construction input only; never place db in an actor context or UI view. */
export type JazzSessionBindingInput = Readonly<{
	db: JazzClient['db']
	identityId: string
	identityKind: 'device' | 'backend'
	binding: object
	isCurrent: () => boolean
	recovery: Readonly<{ capability: RecoveryPhraseCapability; source: RecoveryScopeSource }>
}>

/** Only this native adapter retains the SDK facade. App bindings retain selected leaves. */
type Configuration = Omit<JazzClientConfig, 'client' | 'localFirst'>
export function createJazzSessionRuntime(config: Configuration): SessionRuntimeInput
export function createJazzSessionRuntime<Capabilities>(
	config: Configuration,
	bind: (input: JazzSessionBindingInput) => Capabilities
): SessionRuntimeInput<Capabilities>
export function createJazzSessionRuntime<Capabilities>(
	config: Configuration,
	bind?: (input: JazzSessionBindingInput) => Capabilities
): SessionRuntimeInput<Capabilities | undefined> {
	const captured: JazzClientConfig = { ...config, client: loadLocalFirstClient, localFirst: 'now' }
	return {
		binding: Object.freeze({}),
		capability: {
			open: async () => {
				const session = await createJazzClient(captured)
				const recovery = createJazzRecoveryAdapter(() => session)
				const recoveryBinding = {
					capability: recovery.capability,
					source: {
						subscribe: (notify: Parameters<RecoveryScopeSource['subscribe']>[0]) => {
							const publish = () => notify(recovery.observeSession())
							const stop = session.subscribe(publish)
							publish()
							return stop
						}
					}
				}
				let previous: JazzSessionSnapshot<JazzClient> | undefined
				let binding: object = Object.freeze({})
				let selected: { capabilities: Capabilities | undefined } | undefined
				const read = (): SessionRuntimeObservation<Capabilities | undefined> => {
					const snapshot = session.getSnapshot()
					recovery.observeSession()
					if (snapshot.status !== 'ready') {
						if (previous?.status !== snapshot.status) binding = Object.freeze({})
						previous = snapshot
						selected = undefined
						return snapshot.status === 'signed-out'
							? { status: 'signed-out', binding }
							: { status: snapshot.status }
					}
					if (!snapshot.user || !snapshot.client)
						throw new Error('Jazz ready session resources unavailable')
					if (
						!selected ||
						previous?.status !== 'ready' ||
						previous.user !== snapshot.user ||
						previous.client !== snapshot.client ||
						previous.client?.db !== snapshot.client.db
					) {
						binding = Object.freeze({})
						const currentBinding = binding
						const user = snapshot.user,
							client = snapshot.client,
							db = client.db
						selected = {
							capabilities: bind?.({
								db,
								recovery: recoveryBinding,
								binding: currentBinding,
								identityId: user.accountId,
								identityKind: user.kind,
								isCurrent: () => {
									const now = session.getSnapshot()
									return (
										binding === currentBinding &&
										now.status === 'ready' &&
										now.user === user &&
										now.client === client &&
										now.client.db === db
									)
								}
							})
						}
					}
					previous = snapshot
					return {
						status: 'ready',
						binding,
						identityId: snapshot.user.accountId,
						identityKind: snapshot.user.kind,
						localFirst: snapshot.localFirst,
						capabilities: selected.capabilities
					}
				}
				return {
					observe: (publish, failed) => {
						const notify = () => {
							try {
								publish(read())
							} catch {
								failed()
							}
						}
						const unsubscribe = session.subscribe(notify)
						notify()
						return unsubscribe
					},
					close: async () => {
						recovery.invalidate()
						await session.close()
					},
					changeIdentity: async (change) => {
						if (change.operation === 'retry') {
							await session.retry()
							return 'completed'
						}
						const current = read()
						if (
							!change.before ||
							(current.status !== 'ready' && current.status !== 'signed-out') ||
							current.status !== change.before.status ||
							current.binding !== change.before.binding
						)
							return 'bindingChanged'
						if (change.operation === 'create') await session.createDeviceAccount()
						else if (change.operation === 'restore')
							await session.restoreDeviceAccount(change.credential)
						else await session.signOut()
						return 'completed'
					}
				}
			}
		}
	}
}
