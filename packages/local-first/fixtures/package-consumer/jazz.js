// Typed package host; native key generation/parser, built adapters and workflows.
// Real SDK session/database drain is covered by native consumer/browser qualification.
import { generateAuthSecret } from 'jazz-tools'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import { createActor, createCallbackLogic, waitFor } from 'xstate'

const key = generateAuthSecret()
/** @type {import('jazz-tools/client').JazzUser} */
const user = {
	kind: 'device',
	accountId: crypto.randomUUID(),
	identity: { issuer: 'device', subject: 'package-host' },
	claims: {}
}
/** @type {import('jazz-tools/client').JazzSessionSnapshot<unknown>} */
let snapshot = { status: 'ready', user, localFirst: true }
const session = {
	getSnapshot: () => snapshot,
	exportDeviceKey: () => key,
	restoreDeviceAccount: async (/** @type {string} */ credential) => {
		if (credential !== key) throw new Error('Package restoration changed the credential')
		snapshot = { status: 'ready', user, localFirst: true }
	}
}
const adapter = createJazzRecoveryAdapter(() => session)
try {
	const scope = adapter.observeSession()
	if (scope.kind !== 'available') throw new Error('Packaged adapter did not accept the host scope')
	const phrase = await adapter.capability.readPhrase(scope)
	// Compare booleans so generated credential material cannot enter a failed assertion/report.
	if (RecoveryPhrase.toSecret(phrase) !== key) {
		throw new Error('Packaged adapter did not recover the host-issued root')
	}
	if (session.getSnapshot().user !== user)
		throw new Error('Packaged adapter changed the host session')

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
		if (
			completed.output?.outcome !== 'restored' ||
			completed.output.identityId !== user.accountId
		) {
			throw new Error('Packaged restoration did not recover the intended identity')
		}
		if (session.exportDeviceKey() !== RecoveryPhrase.toSecret(phrase)) {
			throw new Error('Packaged restoration did not preserve the host-issued root')
		}
	} finally {
		restoration.stop()
		recipient.stop()
		restorationAdapter.invalidate()
	}
} finally {
	adapter.invalidate()
}
