import type { WorkspaceCreationDialogView } from 'delightful-local-first/workspace'
import { createWorkspaceCreationOwner } from 'delightful-local-first/workspace/creation-owner'
import type { getDb } from 'jazz-tools/svelte'
import {
	createWorkspaceCreationOperation,
	type CreationBinding
} from './workspace-creation-operation.js'
import type { Organization } from '../../schema.js'
export type WorkspaceCreationView = {
	draftRevision: number
	mode:
		| 'unavailable'
		| 'working'
		| 'editing'
		| 'invalid'
		| 'recovered'
		| 'complete'
		| 'conflict'
		| 'failed'
		| 'unresolved'
	name: string
	workspace: Organization | undefined
	canSubmit: boolean
	canRetry: boolean
	canCreateAnother: boolean
}
export function createWorkspaceCreationMachine(
	db: Pick<ReturnType<typeof getDb>, 'all' | 'beginTransaction'>
) {
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

/** The owner classifies feedback; consumers only translate the supplied descriptor. */
export function workspaceCreationDialogPresentation(view: WorkspaceCreationView): Omit<
	WorkspaceCreationDialogView,
	'feedback'
> & {
	feedback: { kind: WorkspaceCreationView['mode']; priority: 'status' | 'alert'; visible: boolean }
} {
	return {
		activity: view.mode === 'working' ? 'working' : 'idle',
		content: view.mode === 'complete' ? 'complete' : 'fields',
		canSubmit: view.canSubmit,
		canOpen: view.mode !== 'unavailable',
		canRetry: view.canRetry,
		canCreateAnother: view.canCreateAnother,
		fieldsEditable: view.canSubmit,
		draftRevision: view.draftRevision,
		attemptName: view.name,
		feedback: {
			kind: view.mode,
			visible: view.mode !== 'working',
			priority: ['invalid', 'conflict', 'failed', 'unresolved'].includes(view.mode)
				? 'alert'
				: 'status'
		}
	}
}

export type WorkspaceCreationCommand =
	{ type: 'SUBMIT'; name: string } | { type: 'RETRY' | 'NEW' | 'CANCEL' }
