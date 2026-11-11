import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceCreationOperation } from './workspace-creation-operation.js'
import type { JournalResult, workspaceCreationJournal } from './workspace-creation-journal.js'
import {
	attempt,
	creationFixture,
	profileId,
	userId,
	workspace
} from './workspace-creation.fixture.js'
import { createActor, waitFor, createAsyncLogic } from 'xstate'
import type { InputFrom } from 'xstate'

const journal = vi.hoisted(() =>
	vi.fn<(input: InputFrom<typeof workspaceCreationJournal>) => JournalResult>()
)
vi.mock('./workspace-creation-journal.js', async () => {
	const { createAsyncLogic } = await import('xstate')
	return {
		workspaceCreationJournal: createAsyncLogic({
			run: ({ input }: { input: InputFrom<typeof workspaceCreationJournal> }) =>
				Promise.resolve(journal(input))
		})
	}
})
const actors: { stop: () => void }[] = []
afterEach(() => {
	actors.splice(0).forEach((actor) => actor.stop())
	journal.mockReset()
})
const binding = { key: 'environment/user', userId, profileId }
const record = { key: binding.key, attempt }
function start(
	f: ReturnType<typeof creationFixture>,
	request: InputFrom<ReturnType<typeof createWorkspaceCreationOperation>>['request'] = {
		mode: 'retry',
		settlement: 'notStarted',
		record
	}
) {
	journal.mockReturnValue({ outcome: 'succeeded', record })
	const actor = createActor(createWorkspaceCreationOperation(f.db), {
		input: { binding, request }
	}).start()
	actors.push(actor)
	return actor
}

describe('workspace creation result payloads', () => {
	it('returns the workspace and original journal record on completion', async () => {
		const f = creationFixture()
		const done = await waitFor(start(f), (snapshot) => snapshot.status === 'done')
		expect(done.output).toEqual({
			outcome: 'complete',
			record,
			workspace,
			settlement: 'locallyPersisted'
		})
	})
	it('retains unresolved issuance when a loaded record has no durable write evidence', async () => {
		const f = creationFixture()
		const done = await waitFor(start(f, { mode: 'load' }), (snapshot) => snapshot.status === 'done')
		expect(done.output).toEqual({
			outcome: 'unresolved',
			record,
			settlement: 'unresolved',
			error: expect.any(Error)
		})
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('returns invalid input without a record, workspace, or fake error', async () => {
		const f = creationFixture()
		const done = await waitFor(
			start(f, { mode: 'create', name: ' ' }),
			(snapshot) => snapshot.status === 'done'
		)
		expect(done.output).toEqual({ outcome: 'invalid', record: undefined, settlement: 'notStarted' })
		expect(journal).not.toHaveBeenCalled()
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
	it('retains the actual failure and record when preflight fails', async () => {
		const f = creationFixture()
		const error = new Error('Preflight failed')
		f.hydrate.mockReset().mockRejectedValue(error)
		const done = await waitFor(start(f), (snapshot) => snapshot.status === 'done')
		expect(done.output).toEqual({ outcome: 'failed', record, settlement: 'notStarted', error })
	})
	it('returns unresolved settlement with its actual error and record', async () => {
		const f = creationFixture()
		const error = new Error('Local settlement failed')
		f.wait.mockRejectedValue(error)
		const done = await waitFor(start(f), (snapshot) => snapshot.status === 'done')
		expect(done.output).toEqual({ outcome: 'unresolved', record, settlement: 'unresolved', error })
	})
	it('preserves local settlement and the record when shutdown drains a commit', async () => {
		const f = creationFixture()
		const pending = Promise.withResolvers<void>()
		f.wait.mockReturnValue(pending.promise)
		const actor = start(f)
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalled())
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		const done = await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(done.output).toEqual({ outcome: 'closed', record, settlement: 'locallyPersisted' })
		expect(f.rollback).not.toHaveBeenCalled()
	})
})
