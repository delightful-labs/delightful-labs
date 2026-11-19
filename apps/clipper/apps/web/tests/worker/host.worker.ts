/// <reference lib="webworker" />
import { createActor, toPromise } from 'xstate'
import { createLibraryRecords } from '../../src/lib/backend/jazz/records.js'
import { brokerHostClient } from '../../src/lib/runtime/worker/broker-channel.js'
import { diagnosticText } from '../../src/lib/diagnostics/machines.js'
import { createJazzClient } from 'jazz-tools/client'
import { jazzRuntimeSources } from '../../src/lib/backend/jazz/runtime-sources.js'
import { app } from '../../src/lib/backend/jazz/jazz.generated.js'
import { createScopedWorkerAccountStore } from '../../src/lib/runtime/worker/scoped-account-store.js'
import { createScopedAccountStorage } from '../../src/lib/runtime/worker/scoped-storage-channel.js'
import { accountStorageKey } from '../../src/lib/runtime/worker/storage-channel.js'
self.onmessage = async ({ data }) => {
	const storage = createScopedAccountStorage(data.port, data.storageControl, data.storageScope, {
		onOverdue: () => self.postMessage({ type: 'FAILED' }),
		onBlocked: () => self.postMessage({ type: 'FAILED' })
	})
	const store = createScopedWorkerAccountStore(accountStorageKey(data.serverUrl), storage, {
		onOverdue: () => self.postMessage({ type: 'FAILED' })
	})
	const brokerHost = brokerHostClient(data.broker, data.brokerControl, data.brokerScope, {
		onOverdue: () => self.postMessage({ type: 'FAILED' }),
		onBlocked: () => self.postMessage({ type: 'FAILED' })
	})
	let sdkClosed = true
	try {
		const session = await createJazzClient({
			client: () => import('jazz-tools/local-first'),
			serverUrl: data.serverUrl,
			env: 'clipper',
			initial: 'device',
			store,
			runtimeSources: { ...jazzRuntimeSources, browserWorkerHost: brokerHost }
		})
		sdkClosed = false
		try {
			await session
				.getSnapshot()
				.client?.db.upgradeToLocalFirst(() => import('jazz-tools/local-first'))
			const { user, client } = session.getSnapshot()
			if (!user || !client) throw new Error('Worker account unavailable')
			const before = await client.db.one(app.libraries.where({ id: user.accountId }), {
				tier: 'local-first'
			})
			const documentId = crypto.randomUUID()
			const write = client.db.insert(
				app.storageOperations,
				{
					libraryId: user.accountId,
					payloadHash: 'worker-host-proof'
				},
				{ id: documentId }
			)
			await write.wait({ tier: 'local' })
			const after = await client.db.one(app.storageOperations.where({ id: documentId }), {
				tier: 'local-first'
			})
			const records = createLibraryRecords(
				client.db,
				user.accountId,
				() => session.getSnapshot().client === client
			)
			const saving = createActor(records.articles.saveMachine, {
				input: {
					url: 'https://example.com/worker-proof',
					content: {
						title: 'Worker proof',
						text: 'Saved in a worker.',
						html: '<p>Saved in a worker.</p>',
						finalUrl: 'https://example.com/worker-proof',
						provenance: '{}'
					}
				}
			}).start()
			let saved: boolean
			try {
				saved = (await toPromise(saving)).kind === 'saved'
			} finally {
				saving.stop()
			}
			self.postMessage({
				type: 'READY',
				accountId: user.accountId,
				existing: !!before,
				domainSaved: saved,
				written: after?.payloadHash === 'worker-host-proof',
				windowPresent: typeof window !== 'undefined',
				sharedWorker: typeof SharedWorker,
				operationId: documentId
			})
		} finally {
			await session.close()
			sdkClosed = true
		}
	} catch (error) {
		self.postMessage({
			type: 'FAILED',
			message: diagnosticText(error instanceof Error ? error.message : 'Unknown worker failure'),
			sharedWorker: typeof SharedWorker
		})
	} finally {
		try {
			await store.close()
			await storage.close()
			await brokerHost.close()
			self.postMessage(
				sdkClosed ? { type: 'CLOSED' } : { type: 'FAILED', message: 'SDK close failed' }
			)
		} catch {
			self.postMessage({ type: 'FAILED', message: 'Worker fixture close failed' })
		}
	}
}
