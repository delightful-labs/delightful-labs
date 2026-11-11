import { describe, expect, it, vi } from 'vitest'
import type {
	WorkspaceRenameObservation,
	WorkspaceRenameReason
} from '#lib/contracts/workspace-rename-contract.js'
import {
	createWorkspaceRenameAvailability,
	selectWorkspaceRenameAvailability
} from './workspace-rename.js'
import { renameFixture } from './workspace-rename.fixture.js'
import { createActor, waitFor } from 'xstate'

const settle = { outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' }
function settings(
	name: string,
	defaultCurrency: 'USD' | 'TZS' = 'USD'
): { name: string; defaultCurrency: 'USD' | 'TZS' } {
	return { name, defaultCurrency }
}

describe('workspace rename policy', () => {
	it.each([
		{ patch: { sessionReady: false }, reason: 'sessionUnavailable' },
		{ patch: { identityId: null }, reason: 'sessionUnavailable' },
		{ patch: { binding: {} }, reason: 'sessionUnavailable' },
		{ patch: { organizationId: null }, reason: 'selectWorkspace' },
		{ patch: { workspaceError: true, workspaceLoading: true }, reason: 'loadFailed' },
		{ patch: { membershipError: true }, reason: 'loadFailed' },
		{ patch: { workspaceLoading: true, membership: undefined }, reason: 'loading' },
		{ patch: { membershipLoading: true, membership: undefined }, reason: 'loading' },
		{ patch: { workspace: undefined }, reason: 'workspaceUnavailable' },
		{
			patch: { workspace: { id: 'other', name: 'Other', defaultCurrency: 'USD' } },
			reason: 'workspaceUnavailable'
		},
		{ patch: { membership: undefined }, reason: 'readOnly' },
		{
			patch: { membership: { userId: 'other', organizationId: 'workspace', role: 'owner' } },
			reason: 'readOnly'
		},
		{
			patch: { membership: { userId: 'user', organizationId: 'other', role: 'owner' } },
			reason: 'readOnly'
		},
		{
			patch: { membership: { userId: 'user', organizationId: 'workspace', role: 'member' } },
			reason: 'readOnly'
		},
		{
			patch: { membership: { userId: 'user', organizationId: 'workspace', role: 'viewer' } },
			reason: 'readOnly'
		}
	] satisfies { patch: Partial<WorkspaceRenameObservation>; reason: WorkspaceRenameReason }[])(
		'classifies $reason from observed facts',
		({ patch, reason }) => {
			const f = renameFixture()
			const actor = createActor(createWorkspaceRenameAvailability(f.binding), {
				input: { revision: 8, facts: f.setFacts(patch) }
			}).start()
			try {
				expect(selectWorkspaceRenameAvailability(actor.getSnapshot())).toMatchObject({
					revision: 8,
					readiness: { kind: 'blocked', reason }
				})
				const owner = f.owner()
				owner.actor.send({ type: 'SUBMIT', values: settings('Office') })
				expect(owner.view().readiness).toEqual({ kind: 'blocked', reason })
				expect(owner.actor.getSnapshot().context.sequence).toBe(0)
				expect(f.issueRename).not.toHaveBeenCalled()
			} finally {
				actor.stop()
			}
		}
	)
	it.each(['owner', 'admin'] satisfies ('owner' | 'admin')[])('permits the matching %s', (role) => {
		const f = renameFixture()
		f.setFacts({ membership: { userId: 'user', organizationId: 'workspace', role } })
		expect(f.owner().view().readiness).toEqual({ kind: 'ready' })
	})
})

describe('shared edit mode through workspace rename', () => {
	it('saves a changed default currency without changing the workspace name', async () => {
		const f = renameFixture()
		const { actor, view } = f.owner()
		actor.send({ type: 'CHANGE', values: settings('Home', 'TZS') })
		expect(view().canSubmit).toBe(true)
		actor.send({ type: 'SUBMIT', values: settings('Home', 'TZS') })
		await vi.waitFor(() => expect(f.issueRename).toHaveBeenCalledOnce())
		expect(f.issueRename).toHaveBeenCalledExactlyOnceWith('workspace', settings('Home', 'TZS'))
		f.setFacts({ workspace: { id: 'workspace', name: 'Home', defaultCurrency: 'TZS' } })
		actor.send({ type: 'OBSERVE', observation: f.facts() })
		f.saved.resolve(undefined)
		await waitFor(actor, (snapshot) => snapshot.context.result?.outcome === 'succeeded')
		expect(view().canSubmit).toBe(false)
	})

	it('keeps pristine fields editable, rejects unchanged direct submission, and toggles on changed/reverted values', () => {
		const f = renameFixture()
		const { actor, view } = f.owner()
		expect(view()).toMatchObject({ canSubmit: false, fieldsEditable: true })
		actor.send({ type: 'SUBMIT', values: settings(' Home ') })
		expect(actor.getSnapshot().context.sequence).toBe(0)
		expect(f.issueRename).not.toHaveBeenCalled()
		actor.send({ type: 'CHANGE', values: settings('Office') })
		expect(view().canSubmit).toBe(true)
		actor.send({ type: 'CHANGE', values: settings('Home') })
		expect(view().canSubmit).toBe(false)
		actor.send({ type: 'CHANGE', values: settings(' Home ') })
		expect(view().canSubmit).toBe(false)
	})
	it('clears dirty data on accepted reset, scope replacement and shutdown', () => {
		const f = renameFixture()
		const { actor, view } = f.owner()
		actor.send({ type: 'CHANGE', values: settings('Office') })
		actor.send({ type: 'RESET' })
		expect(view()).toMatchObject({ canSubmit: false, fieldsEditable: true, draftRevision: 1 })
		actor.send({ type: 'CHANGE', values: settings('Office') })
		actor.send({
			type: 'OBSERVE',
			observation: f.setFacts({
				organizationId: 'other',
				workspace: { id: 'other', name: 'Other', defaultCurrency: 'USD' },
				membership: { userId: 'user', organizationId: 'other', role: 'owner' }
			})
		})
		expect(view()).toMatchObject({ canSubmit: false, fieldsEditable: true, draftRevision: 2 })
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().context.draft).toBeUndefined()
	})
	it('validates changed input and accepts a corrected direct submission without a CHANGE event', async () => {
		const f = renameFixture()
		const { actor, view } = f.owner()
		actor.send({ type: 'SUBMIT', values: settings(' ') })
		await waitFor(actor, (s) => s.context.result?.outcome === 'invalid')
		expect(view().feedback).toMatchObject({ kind: 'result', result: { outcome: 'invalid' } })
		actor.send({ type: 'SUBMIT', values: settings(' Office ') })
		await vi.waitFor(() => expect(f.issueRename).toHaveBeenCalledTimes(1))
		expect(f.issueRename).toHaveBeenCalledExactlyOnceWith('workspace', settings('Office'))
		actor.send({ type: 'CHANGE', values: settings('Ignored') })
		actor.send({ type: 'RESET' })
		expect(actor.getSnapshot().context.draft).toEqual({
			name: ' Office ',
			defaultCurrency: 'USD'
		})
		f.setFacts({ workspace: { id: 'workspace', name: 'Office', defaultCurrency: 'USD' } })
		actor.send({ type: 'OBSERVE', observation: f.facts() })
		f.saved.resolve(undefined)
		await waitFor(actor, (s) => s.context.result?.outcome === 'succeeded')
		expect(view()).toMatchObject({
			canSubmit: false,
			fieldsEditable: true,
			feedback: { kind: 'result', result: settle }
		})
		actor.send({ type: 'CHANGE', values: settings('Studio') })
		expect(view()).toMatchObject({ canSubmit: true, feedback: { kind: 'none' } })
	})
	it('updates the comparison baseline when a saved observation changes', () => {
		const f = renameFixture()
		const { actor, view } = f.owner()
		actor.send({ type: 'CHANGE', values: settings('Office') })
		actor.send({
			type: 'OBSERVE',
			observation: f.setFacts({
				workspace: { id: 'workspace', name: 'Office', defaultCurrency: 'USD' }
			})
		})
		expect(view().canSubmit).toBe(false)
		actor.send({ type: 'CHANGE', values: settings('Home') })
		expect(view().canSubmit).toBe(true)
	})
	it('preserves create mode without a change-tracking prerequisite or retained draft', async () => {
		const f = renameFixture()
		const { actor, view } = f.owner('create')
		expect(view().canSubmit).toBe(true)
		actor.send({ type: 'SUBMIT', values: settings('Home') })
		await vi.waitFor(() => expect(f.issueRename).toHaveBeenCalledTimes(1))
		expect(actor.getSnapshot().context.draft).toBeUndefined()
		expect(f.issueRename).toHaveBeenCalledExactlyOnceWith('workspace', settings('Home'))
		f.saved.resolve(undefined)
	})
	it('rechecks fresh permission even before reactive observations arrive', async () => {
		const f = renameFixture()
		const { actor } = f.owner()
		f.setFacts({ membership: undefined })
		actor.send({ type: 'SUBMIT', values: settings('Office') })
		await waitFor(actor, (s) => s.context.result?.outcome === 'denied')
		expect(f.issueRename).not.toHaveBeenCalled()
		expect(actor.getSnapshot().context.result).toEqual({
			outcome: 'denied',
			reason: 'readOnly',
			settlement: 'notStarted'
		})
	})
	it('settles issued work after permission loss and rejects new work', async () => {
		const f = renameFixture()
		const { actor, view } = f.owner()
		actor.send({ type: 'SUBMIT', values: settings('Office') })
		await vi.waitFor(() => expect(f.issueRename).toHaveBeenCalledTimes(1))
		actor.send({ type: 'OBSERVE', observation: f.setFacts({ membership: undefined }) })
		expect(view().activity).toEqual({ kind: 'settling', reason: 'scopeChanged' })
		actor.send({ type: 'SUBMIT', values: settings('Another') })
		f.saved.resolve(undefined)
		await waitFor(actor, (s) => s.context.result?.outcome === 'scopeChanged')
		expect(f.issueRename).toHaveBeenCalledTimes(1)
		expect(actor.getSnapshot().context.result).toEqual({
			outcome: 'scopeChanged',
			settlement: 'locallyPersisted'
		})
	})
})
