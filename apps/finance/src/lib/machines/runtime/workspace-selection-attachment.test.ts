import { afterEach, describe, expect, it } from 'vitest'
import { createWorkspaceSelectionMachine } from 'delightful-local-first/workspace/workflow'
import type {
	WorkspaceDrainRequest,
	WorkspaceSelectionEvent
} from 'delightful-local-first/workspace/contracts'
import {
	createWorkspaceSelectionAttachmentMachine,
	type WorkspaceSelectionAttachmentReport,
	type WorkspaceSelectionBinding
} from './workspace-selection-attachment.js'
import { createActor, createCallbackLogic } from 'xstate'

const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function binding(
	revision = 0,
	client: object = {},
	attachment: object = {}
): WorkspaceSelectionBinding {
	return { scope: { binding: client, attachment }, revision }
}
function fixture(
	definition = createWorkspaceSelectionAttachmentMachine(),
	onReport?: (report: WorkspaceSelectionAttachmentReport) => void
) {
	const reports: WorkspaceSelectionAttachmentReport[] = []
	const recipient = createActor(
		createCallbackLogic<WorkspaceSelectionAttachmentReport>(({ receive }) => {
			receive((report) => {
				reports.push(report)
				onReport?.(report)
			})
		})
	).start()
	const actor = createActor(definition, { input: { reportTo: recipient } }).start()
	actors.add(actor)
	actors.add(recipient)
	function command(
		selected: WorkspaceSelectionBinding,
		event: Exclude<WorkspaceSelectionEvent, { type: 'BIND' | 'SHUTDOWN' }>
	) {
		actor.send({ type: 'SELECTION_COMMAND', binding: selected, command: event })
	}
	function select(selected: WorkspaceSelectionBinding, workspaceId = 'workspace-a', attempt = 1) {
		const request = { workspaceId, attempt }
		command(selected, { type: 'SELECT', scope: selected.scope, request })
		command(selected, {
			type: 'OBSERVED',
			observation: {
				scope: selected.scope,
				request,
				generation: 0,
				directory: { status: 'available', entries: [] },
				access: 'allowed'
			}
		})
	}
	function drain(): WorkspaceDrainRequest {
		const report = reports.findLast((value) => value.type === 'WORKSPACE_DRAIN_REQUESTED')
		if (report?.type !== 'WORKSPACE_DRAIN_REQUESTED') throw new Error('Missing drain request')
		return report.drain
	}
	function installed() {
		return reports
			.filter((report) => report.type === 'WORKSPACE_SELECTION_ATTACHED')
			.map((report) => report.binding)
	}
	function released() {
		return reports.filter((report) => report.type === 'WORKSPACE_SELECTION_RELEASED')
	}
	return { actor, reports, command, select, drain, installed, released }
}

describe('workspace selection attachment', () => {
	it('closes unbound without creating or releasing a child', () => {
		const test = fixture()
		test.actor.send({ type: 'SHUTDOWN' })
		expect(test.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
		expect(test.reports).toEqual([])
	})

	it('binds once and forwards real selection reports without using directory membership as access', () => {
		const test = fixture()
		const first = binding()
		test.actor.send({ type: 'ATTACH', binding: first })
		const child = test.actor.getSnapshot().children.selection
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		expect(test.installed()).toEqual([first])
		expect(test.actor.getSnapshot().children.selection).toBe(child)
		expect(test.reports).toContainEqual(
			expect.objectContaining({ type: 'WORKSPACE_SELECTION', status: 'selected' })
		)
	})

	it('retains the issued child until exact drain acknowledgement, then installs the replacement', () => {
		const test = fixture()
		const first = binding()
		const next = binding(1)
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		const child = test.actor.getSnapshot().children.selection
		test.actor.send({ type: 'ATTACH', binding: next })
		const drain = test.drain()
		expect(test.installed()).toEqual([first])
		expect(test.released()).toEqual([])
		expect(test.actor.getSnapshot().children.selection).toBe(child)
		expect(test.reports).toContainEqual({ type: 'WORKSPACE_SCOPE_INVALIDATED', lease: drain.lease })
		test.command(first, { type: 'DRAINED', drain: { ...drain, token: {} } })
		expect(test.released()).toEqual([])
		test.command(next, { type: 'DRAINED', drain })
		expect(test.installed()).toEqual([first])
		test.command(first, { type: 'DRAINED', drain })
		expect(test.released()).toEqual([{ type: 'WORKSPACE_SELECTION_RELEASED', binding: first }])
		expect(test.installed()).toEqual([first, next])
		expect(test.actor.getSnapshot().children.selection).not.toBe(child)
	})

	it('keeps only the newest pending binding while old work drains', () => {
		const test = fixture()
		const first = binding()
		const second = binding(1)
		const third = binding(2)
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		test.actor.send({ type: 'ATTACH', binding: second })
		test.actor.send({ type: 'ATTACH', binding: third })
		test.actor.send({ type: 'ATTACH', binding: second })
		test.command(first, { type: 'DRAINED', drain: test.drain() })
		expect(test.installed()).toEqual([first, third])
	})

	it('can detach pending replacement without cancelling the old drain or reusing its revision', () => {
		const test = fixture()
		const first = binding()
		const second = binding(1)
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		test.actor.send({ type: 'ATTACH', binding: second })
		test.actor.send({ type: 'DETACH', binding: second })
		test.command(first, { type: 'DRAINED', drain: test.drain() })
		test.actor.send({ type: 'ATTACH', binding: second })
		expect(test.actor.getSnapshot().matches('unbound')).toBe(true)
		expect(test.installed()).toEqual([first])
		const third = binding(2)
		test.actor.send({ type: 'ATTACH', binding: third })
		expect(test.installed()).toEqual([first, third])
	})

	it('ignores obsolete detaches and requires the full command binding', () => {
		const test = fixture()
		const first = binding()
		const next = binding(1)
		test.actor.send({ type: 'ATTACH', binding: first })
		test.actor.send({ type: 'ATTACH', binding: next })
		test.actor.send({ type: 'DETACH', binding: first })
		test.select({ ...next, revision: 0 })
		test.select({ ...next, scope: { ...next.scope, binding: {} } })
		test.select({ ...next, scope: { ...next.scope, attachment: {} } })
		expect(
			test.reports.some(
				(report) => report.type === 'WORKSPACE_SELECTION' && report.status === 'selected'
			)
		).toBe(false)
		test.select(next)
		expect(test.installed()).toEqual([first, next])
		expect(test.reports).toContainEqual(expect.objectContaining({ status: 'selected' }))
	})

	it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid revision %s without consuming the first valid binding',
		(revision) => {
			const test = fixture()
			test.actor.send({ type: 'ATTACH', binding: binding(revision) })
			expect(test.installed()).toEqual([])
			const first = binding()
			test.actor.send({ type: 'ATTACH', binding: first })
			expect(test.installed()).toEqual([first])
		}
	)

	it('permits A → B → A only with fresh attachments and increasing revisions', () => {
		const test = fixture()
		const client = {}
		const first = binding(0, client)
		const second = binding(1)
		const third = binding(2, client)
		test.actor.send({ type: 'ATTACH', binding: first })
		test.actor.send({ type: 'ATTACH', binding: second })
		test.actor.send({ type: 'ATTACH', binding: { ...first, revision: 2 } })
		expect(test.installed()).toEqual([first, second])
		test.actor.send({ type: 'ATTACH', binding: third })
		test.select(first)
		expect(
			test.reports.some(
				(report) => report.type === 'WORKSPACE_SELECTION' && report.status === 'selected'
			)
		).toBe(false)
		test.select(third)
		expect(test.installed()).toEqual([first, second, third])
	})

	it('detaches the active binding and remains unbound after actual release', () => {
		const test = fixture()
		const first = binding()
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		test.actor.send({ type: 'DETACH', binding: first })
		expect(test.released()).toEqual([])
		test.command(first, { type: 'DRAINED', drain: test.drain() })
		expect(test.actor.getSnapshot().matches('unbound')).toBe(true)
		expect(test.released()).toHaveLength(1)
	})

	it('preserves shutdown over replacement, late attachments, selection and repeated shutdown', () => {
		const test = fixture()
		const first = binding()
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		test.actor.send({ type: 'ATTACH', binding: binding(1) })
		const drain = test.drain()
		test.actor.send({ type: 'SHUTDOWN' })
		test.actor.send({ type: 'ATTACH', binding: binding(2) })
		test.actor.send({ type: 'SHUTDOWN' })
		test.select(first, 'late-workspace', 2)
		expect(test.actor.getSnapshot().status).toBe('active')
		test.command(first, { type: 'DRAINED', drain })
		expect(test.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
		expect(test.installed()).toEqual([first])
		expect(test.released()).toHaveLength(1)
	})

	it('forwards released partial failure before replacement without labelling it unresolved', () => {
		const test = fixture()
		const first = binding()
		const next = binding(1)
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		test.actor.send({ type: 'ATTACH', binding: next })
		const drain = test.drain()
		test.command(first, { type: 'DRAIN_FAILED', drain, outcome: 'released' })
		expect(test.reports).toContainEqual({
			type: 'WORKSPACE_DRAIN_FAILED',
			drain,
			outcome: 'released'
		})
		expect(test.installed()).toEqual([first, next])
		expect(
			test.reports.findIndex((report) => report.type === 'WORKSPACE_DRAIN_FAILED')
		).toBeLessThan(
			test.reports.findIndex((report) => report.type === 'WORKSPACE_SELECTION_RELEASED')
		)
	})

	it.each(['replace', 'shutdown'])(
		'terminates unresolved during %s without clean release or replacement',
		(intent) => {
			const test = fixture()
			const first = binding()
			test.actor.send({ type: 'ATTACH', binding: first })
			test.select(first)
			if (intent === 'replace') test.actor.send({ type: 'ATTACH', binding: binding(1) })
			else test.actor.send({ type: 'SHUTDOWN' })
			const drain = test.drain()
			test.command(first, { type: 'DRAIN_FAILED', drain, outcome: 'unresolved' })
			expect(test.actor.getSnapshot().output).toEqual({
				outcome: 'failed',
				binding: first,
				failure: { reason: 'unresolved', result: { outcome: 'unresolved', drain } }
			})
			expect(test.released()).toEqual([])
			expect(test.installed()).toEqual([first])
			expect(test.reports).toContainEqual(
				expect.objectContaining({ type: 'WORKSPACE_SELECTION_ATTACHMENT_FAILED', binding: first })
			)
		}
	)

	it('classifies a real child calculation crash without reporting clean release', () => {
		const selection = createWorkspaceSelectionMachine().provide({
			guards: {
				freshSelection: () => {
					throw new Error('controlled child crash')
				}
			}
		})
		const test = fixture(
			createWorkspaceSelectionAttachmentMachine().provide({ actors: { selection } })
		)
		const first = binding()
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		expect(test.actor.getSnapshot().output).toEqual({
			outcome: 'failed',
			binding: first,
			failure: { reason: 'childCrashed' }
		})
		expect(test.released()).toEqual([])
	})

	it('classifies an unsolicited child closure without claiming application resource release', () => {
		const test = fixture()
		const first = binding()
		test.actor.send({ type: 'ATTACH', binding: first })
		const child = test.actor.getSnapshot().children.selection
		if (!child) throw new Error('Missing invoked selection child')
		child.send({ type: 'SHUTDOWN' })
		expect(test.actor.getSnapshot().output).toEqual({
			outcome: 'failed',
			binding: first,
			failure: { reason: 'unexpectedClosure' }
		})
		expect(test.released()).toEqual([])
	})

	it('accepts a synchronous host drain reply without losing replacement completion', () => {
		const first = binding()
		const next = binding(1)
		const test = fixture(undefined, (report) => {
			if (report.type === 'WORKSPACE_DRAIN_REQUESTED') {
				test.command(first, { type: 'DRAINED', drain: report.drain })
			}
		})
		test.actor.send({ type: 'ATTACH', binding: first })
		test.select(first)
		test.actor.send({ type: 'ATTACH', binding: next })
		expect(test.installed()).toEqual([first, next])
		expect(test.released()).toHaveLength(1)
	})

	it('keeps retirement independent for actors sharing one definition', () => {
		const definition = createWorkspaceSelectionAttachmentMachine()
		const left = fixture(definition)
		const right = fixture(definition)
		const shared = binding()
		left.actor.send({ type: 'ATTACH', binding: shared })
		left.actor.send({ type: 'DETACH', binding: shared })
		right.actor.send({ type: 'ATTACH', binding: shared })
		expect(left.released()).toHaveLength(1)
		expect(right.installed()).toEqual([shared])
		expect(right.actor.getSnapshot().matches({ holding: 'active' })).toBe(true)
	})
})
