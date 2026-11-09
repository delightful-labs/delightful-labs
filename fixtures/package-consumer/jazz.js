// The fixture is a host: its own Jazz instance issues the handle consumed by the built adapter.
import { createAccountManager, exportLocalFirstSecret } from 'jazz-tools'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import { createActor, createCallbackLogic, waitFor } from 'xstate'

/** @type {string | null} */
let stored = null
const manager = await createAccountManager({
	appId: 'recovery-package-consumer',
	serverUrl: 'http://127.0.0.1:9',
	store: {
		read: async () => stored,
		update: async (transform) => {
			stored = transform(stored)
		}
	}
})
const account = manager.createLocalFirst()
const adapter = createJazzRecoveryAdapter(() => manager.getLoggedIn())
try {
	const scope = adapter.observeAccount(account)
	if (scope.kind !== 'available') throw new Error('Packaged adapter did not accept the host scope')
	const phrase = await adapter.capability.readPhrase(scope)
	// Compare booleans so generated credential material cannot enter a failed assertion/report.
	if (RecoveryPhrase.toSecret(phrase) !== exportLocalFirstSecret(account)) {
		throw new Error('Packaged adapter did not recover the host-issued root')
	}
	if (manager.getLoggedIn() !== account)
		throw new Error('Packaged adapter changed the host session')

	// A minimal typed host double qualifies built adapter/workflow interoperability with the
	// real SDK parser and account manager. It does not qualify Jazz's real session/client drain.
	const unexpected = async () => {
		throw new Error('Unexpected package-host lifecycle call')
	}
	/** @type {import('jazz-tools/svelte').JazzSession<unknown>} */
	const session = {
		getSnapshot: () => {
			const selected = manager.getLoggedIn()
			return selected ? { status: 'ready', account: selected } : { status: 'signed-out' }
		},
		subscribe: () => () => {},
		restoreLocalFirst: async (credential) => {
			manager.restoreLocalFirst(credential)
		},
		createLocalFirst: unexpected,
		becomeBackend: unexpected,
		registerJWT: unexpected,
		loginJWT: unexpected,
		loginOrRegisterJWT: unexpected,
		linkJWT: unexpected,
		logout: unexpected,
		retry: unexpected,
		close: unexpected
	}
	const restorationAdapter = createJazzRestorationAdapter(session, () => session)
	const restorationScope = { binding: restorationAdapter.binding, attempt: 1 }
	/** @type {import('delightful-local-first/restoration/workflow').RestorationInput['reportTo'] & {stop():void}} */
	const recipient = createActor(
		createCallbackLogic(({ receive }) =>
			receive((event) => {
				if (event.type === 'RESTORATION_PREPARE_REQUESTED') {
					restoration.send({ type: 'PREPARED', ...restorationScope })
				}
			})
		)
	).start()
	const restoration = createActor(restorationMachine, {
		input: {
			scope: restorationScope,
			phrase,
			reportTo: recipient,
			capability: restorationAdapter.capability
		}
	})
	try {
		restoration.start()
		const completed = await waitFor(restoration, (snapshot) => snapshot.status === 'done')
		if (completed.output?.outcome !== 'restored' || completed.output.identityId !== account.id) {
			throw new Error('Packaged restoration did not recover the intended identity')
		}
		const selected = manager.getLoggedIn()
		if (!selected || exportLocalFirstSecret(selected) !== RecoveryPhrase.toSecret(phrase)) {
			throw new Error('Packaged restoration did not preserve the host-issued root')
		}
	} finally {
		restoration.stop()
		recipient.stop()
		restorationAdapter.invalidate()
	}
} finally {
	adapter.invalidate()
	manager.logout()
}
