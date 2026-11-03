import { createJazzSession, exportLocalFirstSecret } from 'jazz-tools'
import { app } from './schema.js'

const config = new URLSearchParams(location.search)
const appId = config.get('appId'),
	serverUrl = config.get('serverUrl')
if (!appId || !serverUrl) throw new Error('Missing isolated fixture configuration')
const session = await createJazzSession({ appId, serverUrl, initial: 'local-first' })
const snapshot = session.getSnapshot()
if (!snapshot.client) throw new Error('Fixture session is not ready')
const db = snapshot.client.db
await db.one(app.workspaces.where({ id: crypto.randomUUID() }), { tier: 'local' })
const ownerId = snapshot.client.session?.user.account
if (!ownerId) throw new Error('Fixture owner missing')

// Test controls expose individual SDK boundaries; the test owns ordering and process termination.
const transactions = new Map<string, ReturnType<typeof db.beginExclusiveTransaction>>()
const commits = new Map<
	string,
	ReturnType<ReturnType<typeof db.beginExclusiveTransaction>['commit']>
>()
const controls = {
	ownerId,
	credential() {
		const account = session.getSnapshot().account
		if (!account) throw new Error('Missing fixture account')
		return exportLocalFirstSecret(account)
	},
	restore(credential: string) {
		return session.restoreLocalFirst(credential)
	},
	acquire(key: string) {
		transactions.set(key, db.beginExclusiveTransaction())
	},
	stage(key: string, operationId: string, workspaceId: string) {
		const tx = transactions.get(key)
		if (!tx) throw new Error('Missing transaction')
		tx.insert(
			app.creationOperations,
			{ ownerId, workspaceId, requestFingerprint: 'fixed-request' },
			{ id: operationId }
		)
		tx.insert(app.workspaces, { ownerId, creationOperationId: operationId }, { id: workspaceId })
	},
	issue(key: string) {
		const tx = transactions.get(key)
		if (!tx) throw new Error('Missing transaction')
		commits.set(key, tx.commit())
	},
	wait(key: string) {
		const handle = commits.get(key)
		if (!handle) throw new Error('Missing commit')
		return handle.wait()
	},
	rollback(key: string) {
		const tx = transactions.get(key)
		if (!tx) throw new Error('Missing transaction')
		return tx.rollback()
	},
	readWorkspace(id: string, tier: 'local' | 'remote') {
		return db.one(app.workspaces.where({ id }), { tier })
	},
	readOperation(id: string, tier: 'local' | 'remote') {
		return db.one(app.creationOperations.where({ id }), { tier })
	}
}
declare global {
	interface Window {
		creationFixture: typeof controls
	}
}
window.creationFixture = controls
