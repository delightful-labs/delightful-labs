import { fixtureWindow as window } from '../state.js'

export const operation45 = async (organizationId: string) => {
	const { app }: typeof import('#lib/queries.js') = await import('#lib/queries.js')
	const { getCurrentJazzSession }: typeof import('../session.js') = await import('../session.js')
	const session = getCurrentJazzSession()?.getSnapshot()
	if (!session?.client || !session.user) throw new Error('Expected initialized session')
	await session.client.db
		.insert(app.simplefinConnections, {
			organizationId,
			ownerId: session.user.accountId,
			accessUrl: '',
			status: 'active',
			credentialVersion: 1,
			credentialId: 'synthetic-credential',
			ciphertext: 'synthetic-ciphertext',
			prfSalt: 'synthetic-salt',
			iv: 'synthetic-iv',
			claimedAt: new Date(),
			lastSyncAt: new Date(),
			lastOutcome: 'failed',
			lastError: 'operation-failed',
			importedCount: 0,
			existingCount: 0,
			omittedCount: 0
		})
		.wait({ tier: 'local' })
}
