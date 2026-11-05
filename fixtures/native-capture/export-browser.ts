import { createActor, toPromise } from 'xstate'
import { prepareJazzArchiveExport } from '../../src/lib/backend/jazz/backup-api.js'
import { createJazzArchiveExportMachine } from '../../src/lib/machines/backup/jazz-export.js'
import type { ArchiveProtection } from '../../src/lib/backup/envelope-api.js'
import { createBrowserSession, type Graph } from './schema.js'
import { createExportReader, testExportProfile } from './export-reader.js'

const config = new URLSearchParams(location.search)
const appId = config.get('appId'),
	serverUrl = config.get('serverUrl')
if (!appId || !serverUrl) throw new Error('Disposable configuration missing')
const session = await createBrowserSession({
	appId,
	serverUrl,
	initial: 'local-first',
	driver: { type: 'persistent', dbName: 'disposable-native-export' }
})
const snapshot = session.getSnapshot(),
	db = snapshot.client?.db,
	account = snapshot.account
if (!db || !account) throw new Error('Disposable browser session not ready')

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
