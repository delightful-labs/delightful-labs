import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import WorkspaceCreationForm from './WorkspaceCreationForm.svelte'
import {
	unavailableWorkspaceCreationView,
	type WorkspaceCreationView
} from '#lib/machines/workspaces/workspace-creation.js'
import { m } from '#lib/paraglide/messages.js'
import { workspace } from '#lib/machines/workspaces/workspace-creation.fixture.js'

function html(view: WorkspaceCreationView) {
	const onSubmit = vi.fn()
	const onRetry = vi.fn()
	const onNew = vi.fn()
	return {
		body: render(WorkspaceCreationForm, {
			props: { scope: 'identity', view, onSubmit, onRetry, onNew }
		}).body,
		onSubmit,
		onRetry,
		onNew
	}
}
describe('Finance shared workspace creation dialog adapter', () => {
	it('uses existing localized labels without issuing creation intent during rendering', () => {
		const { body, onSubmit, onRetry, onNew } = html({
			...unavailableWorkspaceCreationView,
			mode: 'editing',
			canSubmit: true
		})
		expect(body).toContain(
			m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
		)
		expect(body).toContain(m['actions.cancel']())
		expect(onSubmit).not.toHaveBeenCalled()
		expect(onRetry).not.toHaveBeenCalled()
		expect(onNew).not.toHaveBeenCalled()
	})
	it('retains quiet working progress in the status region without a visible duplicate paragraph', () => {
		const { body } = html({ ...unavailableWorkspaceCreationView, mode: 'working' })
		const progress = m['workspace.create_working']()
		expect(body).toContain(progress)
		expect(body).not.toContain(`<p>${progress}</p>`)
		expect(body).toContain('aria-busy="true"')
		expect(body).toContain(m['actions.close']())
	})
	it('retains retry wording and the original attempt name on failure', () => {
		const { body } = html({
			...unavailableWorkspaceCreationView,
			mode: 'failed',
			name: 'Retained workspace',
			canRetry: true
		})
		expect(body).toContain(m['workspace.create_failed']())
		expect(body).toContain('Retained workspace')
		expect(body).toContain(m['actions.retry']())
	})
	it('keeps the consumer completion link scoped to the completed workspace', () => {
		const { body } = html({
			...unavailableWorkspaceCreationView,
			mode: 'complete',
			workspace,
			canCreateAnother: true
		})
		expect(body).toContain(`workspace=${workspace.id}`)
		expect(body).toContain(workspace.name)
		expect(body).toContain(
			m['status.saved_subject']({ subject: m['nouns.workspace']({ count: 1 }) })
		)
		expect(body).not.toContain('<input')
	})
})
