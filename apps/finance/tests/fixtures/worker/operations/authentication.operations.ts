import { fixtureWindow as window } from '../state.js'

export const operation255 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession, loadLocalFirstClient }: typeof import('../session.js') =
		await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Session not ready')
	return (
		await snapshot.client.db.one(app.profiles.where({ userId: snapshot.user.accountId }), {
			tier: 'remote'
		})
	)?.displayName
}

export const operation294 = async (remote: boolean) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession, loadLocalFirstClient }: typeof import('../session.js') =
		await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Session not ready')
	const profile = await snapshot.client.db.one(
		app.profiles.where({ userId: snapshot.user.accountId }),
		remote ? { tier: 'remote' } : {}
	)
	if (!profile) throw new Error('Profile not ready')
	const bytes = profile.avatarData
	return {
		id: profile.id,
		userId: profile.userId,
		displayName: profile.displayName ?? null,
		mimeType: profile.avatarMimeType ?? null,
		byteLength: bytes?.byteLength ?? 0,
		checksum: bytes
			? Array.from(
					new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
				).join(',')
			: null
	}
}

export const operation618 = async () => {
	const { getCurrentJazzSession, loadLocalFirstClient }: typeof import('../session.js') =
		await import('../session.js')
	return getCurrentJazzSession()?.getSnapshot().user?.accountId
}

export const operation680 = async () => {
	const { getCurrentJazzSession, loadLocalFirstClient }: typeof import('../session.js') =
		await import('../session.js')
	const client = getCurrentJazzSession()?.getSnapshot().client
	if (!client) throw new Error('Test session is not ready.')
	window.authFailureTest = { shutdownAttempts: 0, storageFailures: 0 }
	const shutdown = client.shutdown.bind(client)
	client.shutdown = async (options) => {
		window.authFailureTest.shutdownAttempts += 1
		if (window.authFailureTest.shutdownAttempts <= 2)
			throw new Error('Private simulated shutdown failure')
		return shutdown(options)
	}
}

export const operation704 = () => window.authFailureTest.shutdownAttempts

export const operation744 = () => {
	window.authFailureTest = { shutdownAttempts: 0, storageFailures: 0 }
	const put = IDBObjectStore.prototype.put
	IDBObjectStore.prototype.put = function (value, key) {
		if (
			this.transaction.db.name === 'delightful-finances-account-selection' &&
			this.name === 'selections'
		) {
			IDBObjectStore.prototype.put = put
			window.authFailureTest.storageFailures += 1
			throw new DOMException('Simulated local selection failure', 'QuotaExceededError')
		}
		return put.call(this, value, key)
	}
}

export const operation759 = () => window.authFailureTest.storageFailures

export const operation790 = async () => {
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const db = getCurrentJazzSession()?.getSnapshot().client?.db
	if (!db) throw new Error('Test session is not ready.')
	const account = await db.one(app.accounts)
	if (!account) throw new Error('Missing recovery account')
	await db.disconnect()
	await db
		.insert(app.accounts, {
			organizationId: account.organizationId,
			name: 'Pending recovery qualification',
			kind: 'cash',
			currency: 'USD'
		})
		.wait({ tier: 'local' })
	window.authFailureTest = {
		shutdownAttempts: 0,
		storageFailures: 0,
		releaseSharedClient: () => db.reconnect(),
		abortShutdown: () => db.abortGracefulShutdown()
	}
}

export const operation823 = () => window.authFailureTest.abortShutdown?.()

export const operation834 = async () => {
	await window.authFailureTest.releaseSharedClient?.()
}

export const operation928 = async () => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession, loadLocalFirstClient }: typeof import('../session.js') =
		await import('../session.js')
	const snapshot = getCurrentJazzSession()?.getSnapshot()
	if (!snapshot?.client || !snapshot.user) throw new Error('Missing session')
	const db = snapshot.client.db
	const workspace = await db
		.insert(app.organizations, {
			name: 'Additional workspace',
			kind: 'business',
			defaultCurrency: 'USD',
			ownerId: snapshot.user.accountId
		})
		.wait({ tier: 'local' })
	await db
		.insert(app.organizationMembers, {
			organizationId: workspace.id,
			userId: snapshot.user.accountId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'local' })
	return workspace.id
}
