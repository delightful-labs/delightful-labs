import { afterEach, vi } from 'vitest'
import type {
	WorkspaceRenameObservation,
	WorkspaceRenameReason,
	WorkspaceRenameScope
} from '#lib/contracts/workspace-rename-contract.js'
import { createWorkspaceRenameFormOptions, workspaceRenameScope } from './workspace-rename.js'
import { createScopedFormMachine, selectScopedFormView } from '../forms/scoped-form.js'
import { createActor } from 'xstate'
import type { SnapshotFrom } from 'xstate'

const cleanups: (() => void)[] = []
function settings(name: string): { name: string; defaultCurrency: 'USD' | 'TZS' } {
	return { name, defaultCurrency: 'USD' }
}

afterEach(() => {
	cleanups.splice(0).forEach((cleanup) => cleanup())
})

export function renameFixture() {
	const binding = {}
	let facts: WorkspaceRenameObservation = {
		binding,
		identityId: 'user',
		organizationId: 'workspace',
		sessionReady: true,
		workspaceLoading: false,
		membershipLoading: false,
		workspaceError: false,
		membershipError: false,
		workspace: { id: 'workspace', name: 'Home', defaultCurrency: 'USD' },
		membership: { userId: 'user', organizationId: 'workspace', role: 'owner' }
	}
	const saved = Promise.withResolvers<unknown>()
	const observe = vi.fn(() => facts)
	const receipt = { local: saved.promise }
	const issueRename = vi.fn<
		(
			id: string,
			values: { name: string; defaultCurrency: 'USD' | 'TZS' }
		) => { write: typeof receipt }
	>(() => ({ write: receipt }))
	const persistLocal = vi.fn(async (write: typeof receipt) => {
		await write.local
	})
	const options = createWorkspaceRenameFormOptions({ binding, observe, issueRename, persistLocal })
	function owner(mode: 'create' | 'edit' = 'edit') {
		const createMode: { mode: 'create' } = { mode: 'create' }
		const config = mode === 'edit' ? options : { ...options, ...createMode }
		const actor = createActor(
			createScopedFormMachine<
				{ name: string; defaultCurrency: 'USD' | 'TZS' },
				void,
				WorkspaceRenameReason,
				WorkspaceRenameScope,
				WorkspaceRenameObservation,
				SnapshotFrom<typeof options.availability>,
				SnapshotFrom<typeof options.operation>
			>(config),
			{ input: facts }
		).start()
		cleanups.push(() => actor.stop())
		const view = () =>
			selectScopedFormView<
				{ name: string; defaultCurrency: 'USD' | 'TZS' },
				void,
				WorkspaceRenameReason,
				WorkspaceRenameScope,
				WorkspaceRenameObservation,
				SnapshotFrom<typeof options.availability>,
				SnapshotFrom<typeof options.operation>
			>(actor.getSnapshot(), config)
		return { actor, view }
	}
	function operation() {
		const actor = createActor(options.operation, { input: input() }).start()
		cleanups.push(() => actor.stop())
		return actor
	}
	function input() {
		return {
			request: {
				id: 1,
				scope: workspaceRenameScope(facts),
				scopeRevision: 0,
				values: settings('Office')
			},
			observation: { revision: 0, facts }
		}
	}
	return {
		binding,
		observe,
		issueRename,
		persistLocal,
		receipt,
		saved,
		options,
		owner,
		operation,
		input,
		facts: () => facts,
		setFacts: (patch: Partial<WorkspaceRenameObservation>) => {
			facts = { ...facts, ...patch }
			return facts
		}
	}
}
