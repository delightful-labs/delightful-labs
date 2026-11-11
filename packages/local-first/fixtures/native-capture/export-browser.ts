import { createActor, toPromise } from 'xstate'
import { prepareJazzArchiveExport } from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import type { ArchiveProtection } from '../../src/lib/backup/envelope-api.js'
import { createBrowserSession, loadLocalFirst, type Graph } from './schema.js'
import { createExportReader, testExportProfile } from './export-reader.js'

const config = new URLSearchParams(location.search)
const appId = config.get('appId'),
	serverUrl = config.get('serverUrl')
if (!appId || !serverUrl) throw new Error('Disposable configuration missing')
const session = await createBrowserSession({
	scope: appId,
	serverUrl,
	initial: 'local-first',
	client: loadLocalFirst,
	driver: { type: 'persistent', dbName: 'disposable-native-export' }
})
const snapshot = session.getSnapshot(),
	client = snapshot.client,
	account = snapshot.account
if (!client || !account) throw new Error('Disposable browser session not ready')
await client.db.upgradeToLocalFirst(loadLocalFirst)
const db = client.db
if (!db.isLocalFirst()) throw new Error('Native export requires local-first storage')

const api = {
	async export(graph: Graph, protection: ArchiveProtection) {
		const request = prepareJazzArchiveExport({
			db,
			profile: testExportProfile,
			protection,
			binding: {
				applicationId: 'native-test',
				workspaceId: graph.workspace,
				identityId: account.id,
				generation: 1,
				operationId: crypto.randomUUID(),
				environment: 'disposable'
			},
			isCurrent: () => session.getSnapshot().client?.db === db,
			handoff: {
				dispatch: async (file) => {
					const bytes = file.copyBytes()
					const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }))
					try {
						const anchor = document.createElement('a')
						anchor.href = url
						anchor.download = 'native-backup.json'
						anchor.click()
						return 'dispatched'
					} finally {
						bytes.fill(0)
						setTimeout(() => URL.revokeObjectURL(url), 0)
					}
				}
			}
		})
		const actor = createActor(createJazzArchiveExportMachine(createExportReader(graph)), {
			input: { request }
		})
		actor.start()
		return toPromise(actor)
	},
	close: () => session.close()
}
declare global {
	interface Window {
		NativeArchiveExport: typeof api
	}
}
window.NativeArchiveExport = api
