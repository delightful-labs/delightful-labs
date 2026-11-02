import type { WorkspaceDirectory } from '../contracts/workspace-selection.js'
import type { WorkspaceSelectorView } from '../contracts/workspace-selector.js'

export type WorkspaceSelectorInput = Readonly<{
	directory: WorkspaceDirectory
	workspaceId: string | null
	disabled?: boolean
	/** The consumer supplies a localized name/ID template; names are never concatenated as prose. */
	duplicateName: (name: string, id: string) => string
}>

/** Project locally available choices. Selection authorization and drain remain with the owner. */
export function createWorkspaceSelectorView(input: WorkspaceSelectorInput): WorkspaceSelectorView {
	if (input.directory.status !== 'available') return { kind: 'unavailable' }
	const rows = input.directory.entries
	if (rows.length === 0) return { kind: 'empty' }
	const names = new Map<string, number>()
	for (const row of rows) names.set(row.name, (names.get(row.name) ?? 0) + 1)
	const selectedId = rows.find((row) => row.id === input.workspaceId)?.id ?? ''
	return {
		kind: 'choices',
		entries: rows.map((row) => ({
			id: row.id,
			label: (names.get(row.name) ?? 0) > 1 ? input.duplicateName(row.name, row.id) : row.name
		})),
		selectedId,
		canChoose: !input.disabled && (rows.length > 1 || selectedId === '')
	}
}
