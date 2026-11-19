import type { Db } from 'jazz-tools'
import { app } from './jazz/jazz.generated.js'
export { app }
export { createJazzClient as createBrowserSession } from 'jazz-tools/client'
export const loadLocalFirst = () => import('jazz-tools/local-first')
import permissions from './jazz/jazz.permissions.json' with { type: 'json' }
export { permissions }

export type Graph = { workspace: string; entry: string; file: string; part: string }
export const bytes = (revision: number) =>
	Uint8Array.from([revision, 0, 255, 128, 10, 13, 1, revision])
export async function readGraph(
	db: Pick<Db, 'all'>,
	graph: Graph,
	tier: 'remote' | 'local-first' = 'remote'
) {
	// Alpha.67 browser snapshots require ordered reads, as in Finance's reader.
	const roots = await db.all(app.workspaces.where({ id: graph.workspace }), { tier })
	const entries = await db.all(app.entries.where({ workspaceId: graph.workspace }), { tier })
	const files = await db.all(app.files.where({ workspaceId: graph.workspace }), { tier })
	const parts = await db.all(app.parts.where({ workspaceId: graph.workspace }), { tier })
	return {
		counts: [roots.length, entries.length, files.length, parts.length],
		versions: [roots[0]?.revision, entries[0]?.revision, files[0]?.revision, parts[0]?.data[0]],
		bytes: parts.map((part) => Array.from(part.data))
	}
}
