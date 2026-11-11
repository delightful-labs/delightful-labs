import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import WorkspaceCreationDialog from '../components/workspaces/WorkspaceCreationDialog.svelte'
import type { WorkspaceCreationDialogView } from '../contracts/workspace-creation-dialog.js'

const view: WorkspaceCreationDialogView = {
	canOpen: true,
	canSubmit: true,
	canRetry: false,
	canCreateAnother: false,
	fieldsEditable: true,
	activity: 'idle',
	content: 'fields',
	draftRevision: 0,
	attemptName: '',
	feedback: { text: '', priority: 'status' }
}
const messages = {
	heading: 'Create workspace',
	nameLabel: 'Workspace name',
	submit: 'Create',
	cancel: 'Cancel',
	close: 'Close',
	retry: 'Retry',
	createAnother: 'Create another'
}
function props() {
	return {
		scope: 'identity-a',
		view,
		messages,
		onSubmit: vi.fn(),
		onRetry: vi.fn(),
		onNew: vi.fn()
	}
}
describe('workspace creation dialog SSR boundary', () => {
	it('renders a closed native dialog and a uniquely associated required name without effects', () => {
		const input = props()
		const { body } = render(WorkspaceCreationDialog, { props: input })
		const id = body.match(/<input[^>]*id="([^"]+)"/)?.[1]
		expect(id).toBeTruthy()
		expect(body).toContain(`for="${id}"`)
		expect(body).toMatch(/<input[^>]*required/)
		expect(body).not.toMatch(/<dialog[^>]*\sopen(?:\s|>|=)/)
		expect(input.onSubmit).not.toHaveBeenCalled()
		expect(input.onRetry).not.toHaveBeenCalled()
		expect(input.onNew).not.toHaveBeenCalled()
	})
	it('does not enable an unavailable trigger', () => {
		const { body } = render(WorkspaceCreationDialog, {
			props: { ...props(), view: { ...view, canOpen: false } }
		})
		expect(body).toMatch(/<button[^>]*disabled[^>]*>.*?Create workspace/s)
	})
	it('keeps localization isolated between server requests', () => {
		const first = render(WorkspaceCreationDialog, { props: props() }).body
		const second = render(WorkspaceCreationDialog, {
			props: {
				...props(),
				messages: { ...messages, heading: 'Créer un espace', nameLabel: 'Nom de l’espace' }
			}
		}).body
		expect(first).toContain('Workspace name')
		expect(first).not.toContain('Nom de l’espace')
		expect(second).toContain('Nom de l’espace')
		expect(second).not.toContain('Workspace name')
	})
	it('renders host-supplied failure text and retained attempt without classifying outcomes', () => {
		const { body } = render(WorkspaceCreationDialog, {
			props: {
				...props(),
				view: {
					...view,
					canSubmit: false,
					fieldsEditable: false,
					canRetry: true,
					attemptName: 'Retained ledger',
					feedback: { text: 'Host-specific failure', priority: 'alert' }
				}
			}
		})
		expect(body).toContain('Host-specific failure')
		expect(body).toContain('Retained ledger')
		expect(body).toContain('Retry')
		expect(body).toMatch(/role="alert"/)
	})
})
