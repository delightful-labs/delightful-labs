import { createWorkspaceCreationOwner } from 'delightful-local-first/workspace/creation-owner'
import type { Db as JazzDb } from 'jazz-tools'
import {
	createWorkspaceCreationOperation,
	type CreationBinding
} from './workspace-creation-operation.js'
import type { Organization } from '../../queries.js'
import type { WorkspaceCreationView } from '../../contracts/workspace-creation-view.js'
export type { WorkspaceCreationView } from '../../contracts/workspace-creation-view.js'
export function createWorkspaceCreationMachine(db: Pick<JazzDb, 'all' | 'beginTransaction'>) {
	const operation = createWorkspaceCreationOperation(db)
	return createWorkspaceCreationOwner<
		import('./workspace-creation-journal.js').WorkspaceJournalRecord,
		Organization,
		import('xstate').SnapshotFrom<typeof operation>,
		CreationBinding
	>(operation)
}

export function selectWorkspaceCreationView(
	snapshot: import('xstate').SnapshotFrom<ReturnType<typeof createWorkspaceCreationMachine>>
): WorkspaceCreationView {
	const value = snapshot.value
	const mode =
		typeof value === 'object'
			? 'working'
			: value === 'checking' || value === 'classifying'
				? 'working'
				: value === 'closed'
					? 'unavailable'
					: value
	const replacing =
		snapshot.matches({ operating: 'replacing' }) || snapshot.matches({ operating: 'closing' })
	return {
		draftRevision: snapshot.context.draftRevision,
		mode,
		name: replacing ? '' : (snapshot.context.bindingState.record?.attempt.workspace.name ?? ''),
		workspace:
			!replacing && snapshot.context.result?.outcome === 'complete'
				? snapshot.context.result.workspace
				: undefined,
		canSubmit: mode === 'editing' || mode === 'invalid',
		canRetry: ['recovered', 'failed', 'unresolved', 'conflict'].includes(mode),
		canCreateAnother: mode === 'complete'
	}
}

export const unavailableWorkspaceCreationView: WorkspaceCreationView = {
	draftRevision: 0,
	mode: 'unavailable',
	name: '',
	workspace: undefined,
	canSubmit: false,
	canRetry: false,
	canCreateAnother: false
}

/** Public identity-bound projection; consumers do not inspect creation context themselves. */
export function selectWorkspaceCreationReport(
	snapshot: import('xstate').SnapshotFrom<ReturnType<typeof createWorkspaceCreationMachine>>
) {
	return {
		binding: snapshot.context.bindingState.binding,
		view: selectWorkspaceCreationView(snapshot)
	}
}

export { workspaceCreationDialogPresentation } from '../../contracts/workspace-creation-view.js'
export type { WorkspaceCreationCommand } from '../../contracts/workspace-creation-view.js'
