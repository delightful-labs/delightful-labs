import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceNamingPersistence } from './workspace-naming-persistence.js'
import { renameFixture } from './workspace-rename.fixture.js'
import { createActor, waitFor } from 'xstate'

const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
const interruptions = [
	{ type: 'CANCEL', outcome: 'cancelled' },
	{ type: 'INVALIDATE', outcome: 'scopeChanged' },
	{ type: 'SHUTDOWN', outcome: 'closed' }
] satisfies {
	type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'
	outcome: 'cancelled' | 'scopeChanged' | 'closed'
}[]
function fixture(values?: { name: string; defaultCurrency: 'USD' | 'TZS' }) {
	const f = renameFixture()
	const input = f.input()
	if (values) input.request.values = values
	const actor = createActor(createWorkspaceNamingPersistence(f), { input })
	actors.add(actor)
	return {
		...f,
		input,
		actor,
		done: async () => (await waitFor(actor, (s) => s.status === 'done', { timeout: 1_000 })).output
	}
}
describe('Finance naming persistence child', () => {
	it('preserves request correlation and keeps currency with the canonical name in one update', async () => {
		const f = fixture({ name: ' Office ', defaultCurrency: 'TZS' })
		f.actor.start()
		await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledOnce())
		const child = f.actor.getSnapshot().children.naming
		const scope = child?.getSnapshot().context.request.scope
		expect(scope).toEqual({
			requestId: f.input.request.id,
			scopeRevision: f.input.request.scopeRevision,
			workspace: f.input.request.scope
		})
		expect(scope?.workspace).toBe(f.input.request.scope)
		expect(f.issueRename).toHaveBeenCalledExactlyOnceWith('workspace', {
			name: 'Office',
			defaultCurrency: 'TZS'
		})
		expect(f.persistLocal).toHaveBeenCalledExactlyOnceWith(f.receipt)
		f.saved.resolve(undefined)
		expect(await f.done()).toEqual({
			outcome: 'succeeded',
			value: undefined,
			settlement: 'locallyPersisted'
		})
	})
	it.each(interruptions)(
		'prevents issuing a write after early $type',
		async ({ type, outcome }) => {
			const f = fixture()
			f.actor.start()
			f.actor.send({ type })
			expect(await f.done()).toEqual({ outcome, settlement: 'notStarted' })
			expect(f.issueRename).not.toHaveBeenCalled()
		}
	)
	it.each(interruptions)('drains an issued update after $type', async ({ type, outcome }) => {
		const f = fixture()
		f.actor.start()
		await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledOnce())
		f.actor.send({ type })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.saved.resolve(undefined)
		expect(await f.done()).toEqual({ outcome, settlement: 'locallyPersisted' })
		expect(f.issueRename).toHaveBeenCalledOnce()
	})
	it('retains unknown settlement and shutdown priority after a rejected local wait', async () => {
		const f = fixture()
		f.actor.start()
		await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledOnce())
		f.actor.send({ type: 'INVALIDATE' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'CANCEL' })
		f.saved.reject(new Error('Private error details'))
		expect(await f.done()).toEqual({ outcome: 'closed', settlement: 'unknown' })
		expect(f.issueRename).toHaveBeenCalledOnce()
	})
	it('maps a thrown issue to generic failure and never replays it', async () => {
		const f = fixture()
		f.issueRename.mockImplementation(() => {
			throw new Error('Private issue failure')
		})
		f.actor.start()
		expect(await f.done()).toEqual({
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'unknown'
		})
		expect(f.issueRename).toHaveBeenCalledOnce()
		expect(f.persistLocal).not.toHaveBeenCalled()
	})
})
