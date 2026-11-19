import type { WorkspaceCreationDialogView } from 'delightful-local-first/workspace'
import type { Organization } from '../queries.js'
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
