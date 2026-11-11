import { schema as s, type Db } from 'jazz-tools'
export { createJazzClient as createBrowserSession } from 'jazz-tools/client'
export const loadLocalFirst = () => import('jazz-tools/local-first')

export const app = s.defineApp(
	{
		workspaces: s.table({ revision: s.int(), allowed: s.boolean(), visible: s.boolean() }, {}),
		entries: s.table(
			{ workspaceId: s.uuid(), fileId: s.uuid(), revision: s.int() },
			{ workspace: s.rel('workspaces', 'workspaceId'), file: s.rel('files', 'fileId') }
		),
		files: s.table(
			{ workspaceId: s.uuid(), revision: s.int(), sizeBytes: s.int() },
			{ parts: s.reverse('parts', 'file') }
		),
		parts: s.table(
			{ workspaceId: s.uuid(), fileId: s.uuid(), partIndex: s.int(), data: s.bytes() },
			{ file: s.rel('files', 'fileId') }
		)
	},
	{ migrations: 'none' }
)
export const permissions = s.definePermissions(app, ({ policy }) => {
	policy.workspaces.allowRead.where({ visible: true })
	policy.workspaces.allowInsert.where({ allowed: true })
	policy.workspaces.allowUpdate.where({ allowed: true })
	policy.workspaces.allowDelete.always()
	for (const table of [policy.entries, policy.files, policy.parts]) {
		table.allowRead.always()
		table.allowInsert.always()
		table.allowUpdate.always()
		table.allowDelete.always()
	}
})

export type Graph = { workspace: string; entry: string; file: string; part: string }
export const bytes = (revision: number) =>
	Uint8Array.from([revision, 0, 255, 128, 10, 13, 1, revision])
export async function readGraph(
	db: Pick<Db, 'all'>,
	graph: Graph,
	tier: 'remote' | 'local-first' = 'remote'
) {
	const [roots, entries, files, parts] = await Promise.all([
		db.all(app.workspaces.where({ id: graph.workspace }), { tier }),
		db.all(app.entries.where({ workspaceId: graph.workspace }), { tier }),
		db.all(app.files.where({ workspaceId: graph.workspace }), { tier }),
		db.all(app.parts.where({ workspaceId: graph.workspace }), { tier })
	])
	return {
		counts: [roots.length, entries.length, files.length, parts.length],
		versions: [roots[0]?.revision, entries[0]?.revision, files[0]?.revision, parts[0]?.data[0]],
		bytes: parts.map((part) => Array.from(part.data))
	}
}
