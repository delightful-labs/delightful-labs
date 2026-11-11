import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
	CreationBinding,
	CreationRequest,
	CreationResult
} from './workspace-creation-operation.js'
import {
	createWorkspaceCreationMachine,
	selectWorkspaceCreationView,
	workspaceCreationDialogPresentation,
	unavailableWorkspaceCreationView
} from './workspace-creation.js'
import {
	attempt,
	creationFixture,
	userId,
	profileId,
	workspace
} from './workspace-creation.fixture.js'
import { createActor, setup, types } from 'xstate'
import type { AnyActorRef } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

const { started, interrupted } = vi.hoisted(() => ({ started: vi.fn(), interrupted: vi.fn() }))
vi.mock('./workspace-creation-operation.js', () => ({
	createWorkspaceCreationOperation: () =>
		setup({
			schemas: {
				context: types<{ result: CreationResult }>(),
				events: {
					FINISH:
						types<
							EventPayload<
								{ type: 'FINISH'; result: CreationResult } | { type: 'SHUTDOWN' | 'CANCEL' },
								'FINISH'
							>
						>(),
					SHUTDOWN:
						types<
							EventPayload<
								{ type: 'FINISH'; result: CreationResult } | { type: 'SHUTDOWN' | 'CANCEL' },
								'SHUTDOWN'
							>
						>(),
					CANCEL:
						types<
							EventPayload<
								{ type: 'FINISH'; result: CreationResult } | { type: 'SHUTDOWN' | 'CANCEL' },
								'CANCEL'
							>
						>()
				},
				input: types<{ binding: CreationBinding; request: CreationRequest }>(),
				output: types<CreationResult>()
			}
		}).createMachine({
			initial: 'waiting',
			context: ({ input }) => {
				started(input)
				return {
					result: {
						outcome: 'editing',
						record: undefined,
						settlement: 'notStarted'
					} satisfies CreationResult
				}
			},
			output: ({ context }) => context.result,
			states: {
				waiting: {
					on: {
						SHUTDOWN: (_, enq) => {
							enq(interrupted)
						},
						CANCEL: (_, enq) => {
							enq(interrupted)
						},
						FINISH: (args) => {
							return { target: 'done', context: { result: args.event.result } }
						}
					}
				},
				done: { type: 'final' }
			}
		})
}))
const actors: { stop: () => void }[] = []
afterEach(() => {
	actors.splice(0).forEach((actor) => actor.stop())
	vi.clearAllMocks()
})
const binding = { key: 'environment/user', userId, profileId }
const record = { key: binding.key, attempt }

function start() {
	const f = creationFixture()
	const actor = createActor(createWorkspaceCreationMachine(f.db), { input: { binding } }).start()
	actors.push(actor)
	return actor
}
function finish(actor: ReturnType<typeof start>, value: CreationResult) {
	const child: AnyActorRef | undefined = actor.getSnapshot().children.operation
	if (!child) throw new Error('Expected operation')
	child.send({ type: 'FINISH', result: value })
}
describe('workspace creation owner', () => {
	it('ignores double submit and does not replay a recovered attempt on load', () => {
		const actor = start()
		actor.send({ type: 'SUBMIT', name: 'Ignored during load' })
		expect(started).toHaveBeenCalledTimes(1)
		finish(actor, { outcome: 'recovered', record, settlement: 'notStarted' })
		actor.send({ type: 'OBSERVED', binding: { ...binding } })
		expect(actor.getSnapshot().matches('recovered')).toBe(true)
		expect(started).toHaveBeenCalledTimes(1)
		actor.send({ type: 'RETRY' })
		expect(started.mock.lastCall?.[0].request).toEqual({
			mode: 'retry',
			record,
			settlement: 'notStarted'
		})
	})
	it('waits for original resources before replacing identity and uses the latest observation', () => {
		const actor = start()
		actor.send({ type: 'OBSERVED', binding: { ...binding, key: 'second' } })
		actor.send({ type: 'OBSERVED', binding: { ...binding, key: 'third' } })
		expect(actor.getSnapshot().matches({ operating: 'replacing' })).toBe(true)
		expect(started).toHaveBeenCalledTimes(1)
		finish(actor, { outcome: 'closed', record, settlement: 'notStarted' })
		expect(started).toHaveBeenCalledTimes(2)
		expect(started.mock.lastCall?.[0].binding.key).toBe('third')
	})
	it('preserves shutdown over late binding changes and retries', () => {
		const actor = start()
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'OBSERVED', binding: { ...binding, key: 'late' } })
		actor.send({ type: 'RETRY' })
		expect(actor.getSnapshot().status).toBe('active')
		finish(actor, { outcome: 'closed', record: undefined, settlement: 'notStarted' })
		expect(actor.getSnapshot().status).toBe('done')
		expect(started).toHaveBeenCalledTimes(1)
	})
	it('rereads a journal after cancelled loading or a conflict retry', () => {
		const actor = start()
		actor.send({ type: 'CANCEL' })
		finish(actor, { outcome: 'cancelled', record: undefined, settlement: 'notStarted' })
		expect(started).toHaveBeenCalledTimes(2)
		expect(started.mock.lastCall?.[0].request).toEqual({ mode: 'load' })
		finish(actor, { outcome: 'conflict', record, settlement: 'notStarted' })
		actor.send({ type: 'RETRY' })
		expect(started.mock.lastCall?.[0].request).toEqual({ mode: 'load' })
	})
	it('requires an explicit new action after completion', () => {
		const actor = start()
		finish(actor, { outcome: 'complete', record, workspace, settlement: 'locallyPersisted' })
		expect(selectWorkspaceCreationView(actor.getSnapshot()).workspace).toEqual(workspace)
		actor.send({ type: 'SUBMIT', name: 'Ignored after success' })
		expect(started).toHaveBeenCalledTimes(1)
		actor.send({ type: 'NEW' })
		expect(started.mock.lastCall?.[0].request).toEqual({ mode: 'clear', record })
	})
})

describe('workspace creation dialog projection', () => {
	it.each([
		['unavailable', 'status', true],
		['working', 'status', false],
		['editing', 'status', true],
		['invalid', 'alert', true],
		['recovered', 'status', true],
		['complete', 'status', true],
		['conflict', 'alert', true],
		['failed', 'alert', true],
		['unresolved', 'alert', true]
	] satisfies [typeof unavailableWorkspaceCreationView.mode, 'status' | 'alert', boolean][])(
		'classifies %s feedback at the owning boundary',
		(mode, priority, visible) => {
			const view = workspaceCreationDialogPresentation({
				...unavailableWorkspaceCreationView,
				mode
			})
			expect(view.feedback).toEqual({ kind: mode, priority, visible })
			expect(view.canOpen).toBe(mode !== 'unavailable')
			expect(view.content).toBe(mode === 'complete' ? 'complete' : 'fields')
		}
	)
	it('preserves draft identity across invalid results and retries until a genuinely new entry', () => {
		const actor = start()
		finish(actor, { outcome: 'editing', record: undefined, settlement: 'notStarted' })
		const revision = selectWorkspaceCreationView(actor.getSnapshot()).draftRevision
		expect(revision).toBe(1)
		actor.send({ type: 'SUBMIT', name: '  ' })
		finish(actor, { outcome: 'invalid', record: undefined, settlement: 'notStarted' })
		expect(selectWorkspaceCreationView(actor.getSnapshot()).draftRevision).toBe(revision)
		actor.send({ type: 'SUBMIT', name: 'Personal' })
		finish(actor, {
			outcome: 'failed',
			record,
			settlement: 'notStarted',
			error: new Error('storage')
		})
		actor.send({ type: 'RETRY' })
		expect(started.mock.lastCall?.[0].request).toEqual({
			mode: 'retry',
			record,
			settlement: 'notStarted'
		})
		expect(selectWorkspaceCreationView(actor.getSnapshot()).draftRevision).toBe(revision)
		finish(actor, { outcome: 'complete', record, workspace, settlement: 'locallyPersisted' })
		actor.send({ type: 'NEW' })
		finish(actor, { outcome: 'editing', record: undefined, settlement: 'notStarted' })
		expect(selectWorkspaceCreationView(actor.getSnapshot()).draftRevision).toBe(revision + 1)
	})
})
