import { schema as s } from 'jazz-tools'
export const schema = s.defineSchema({
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
})
