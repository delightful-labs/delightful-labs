import { afterEach, describe, expect, it } from 'vitest'
import { createActor, createCallbackLogic } from 'xstate'
import type {
	WorkspaceDirectory,
	WorkspaceDrainRequest,
	WorkspaceSelectionObservation,
	WorkspaceSelectionReport,
	WorkspaceSelectionRequest
} from '../../contracts/workspace-selection.js'
import { createWorkspaceSelectionMachine, selectWorkspaceLease } from './selection.js'

const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(bind = true, autoDrain = false) {
	const reports: WorkspaceSelectionReport[] = []
	const recipient = createActor(
		createCallbackLogic<WorkspaceSelectionReport>(({ receive }) =>
			receive((event) => {
				reports.push(event)
				if (autoDrain && event.type === 'WORKSPACE_DRAIN_REQUESTED')
					actor.send({ type: 'DRAINED', drain: event.drain })
			})
		)
	).start()
	const actor = createActor(createWorkspaceSelectionMachine(), {
		input: { reportTo: recipient }
	}).start()
	actors.add(actor)
	actors.add(recipient)
	const scope = { binding: {}, attachment: {} }
	let request: WorkspaceSelectionRequest = { workspaceId: 'a', attempt: 0 }
	function select(workspaceId = 'a', attempt = request.attempt + 1) {
		request = { workspaceId, attempt }
		actor.send({ type: 'SELECT', scope, request })
		return request
	}
	function observation(
		access: WorkspaceSelectionObservation['access'] = 'allowed',
		generation = 0,
		directory: WorkspaceDirectory = { status: 'available', entries: [] }
	): WorkspaceSelectionObservation {
		return { scope, request, generation, access, directory }
	}
	function observe(
		access: WorkspaceSelectionObservation['access'] = 'allowed',
		generation = 0,
		directory?: WorkspaceDirectory
	) {
		const value = observation(access, generation, directory)
		actor.send({ type: 'OBSERVED', observation: value })
		return value
	}
	function drain() {
		const report = reports.filter((event) => event.type === 'WORKSPACE_DRAIN_REQUESTED').at(-1)
		if (!report) throw new Error('Expected host drain request')
		return report.drain
	}
	function lease() {
		const value = selectWorkspaceLease(actor.getSnapshot())
		if (!value) throw new Error('Expected public workspace lease')
		return value
	}
	if (bind) actor.send({ type: 'BIND', scope })
	return {
		actor,
		reports,
		scope,
		select,
		observation,
		observe,
		drain,
		lease,
		activate: (workspaceId = 'a') => {
			select(workspaceId)
			observe()
		}
	}
}
function status(f: ReturnType<typeof fixture>) {
	return f.reports.filter((event) => event.type === 'WORKSPACE_SELECTION').at(-1)?.status
}

describe('workspace selection ownership', () => {
	it('waits for binding and closes without host effects', () => {
		const f = fixture(false)
		f.select()
		f.observe()
		expect(f.reports).toEqual([])
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'BIND', scope: f.scope })
		expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
	})
	it('never chooses a workspace without explicit intent or invents access from directory rows', () => {
		const f = fixture()
		f.actor.send({
			type: 'OBSERVED',
			observation: { ...f.observation(), request: { workspaceId: 'a', attempt: 1 } }
		})
		expect(status(f)).toBe('waiting')
		f.select()
		f.observe('unknown', 0, { status: 'available', entries: [{ id: 'a', name: 'Workspace' }] })
		expect(status(f)).toBe('waiting')
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
	})
	it.each<WorkspaceDirectory>([
		{ status: 'loading' },
		{ status: 'unavailable' },
		{ status: 'failed' },
		{ status: 'available', entries: [] },
		{ status: 'available', entries: [{ id: 'other', name: 'Other workspace' }] }
	])('uses allowed target facts independently of directory $status', (directory) => {
		const f = fixture()
		f.select()
		f.observe('allowed', 0, directory)
		expect(f.lease().request.workspaceId).toBe('a')
		expect(status(f)).toBe('selected')
		expect(f.reports.at(-1)).toMatchObject({ type: 'WORKSPACE_SELECTION', directory })
	})
	it.each([
		'unknown',
		'denied',
		'unavailable',
		'failed'
	] satisfies WorkspaceSelectionObservation['access'][])(
		'reports %s without acquiring or draining a scope',
		(access) => {
			const f = fixture()
			f.select()
			f.observe(access)
			expect(status(f)).toBe(access === 'unknown' ? 'waiting' : access)
			expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
			expect(f.reports.some((r) => r.type === 'WORKSPACE_DRAIN_REQUESTED')).toBe(false)
			f.actor.send({ type: 'SHUTDOWN' })
			expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
		}
	)
	it('ignores replacement binding, invalid intents, and stale or foreign observations', () => {
		const f = fixture()
		f.actor.send({ type: 'BIND', scope: { binding: {}, attachment: {} } })
		for (const attempt of [-1, 0, 0.5, Infinity, NaN])
			f.actor.send({ type: 'SELECT', scope: f.scope, request: { workspaceId: 'a', attempt } })
		f.actor.send({ type: 'SELECT', scope: f.scope, request: { workspaceId: ' ', attempt: 1 } })
		f.actor.send({
			type: 'SELECT',
			scope: { ...f.scope, binding: {} },
			request: { workspaceId: 'a', attempt: 1 }
		})
		f.actor.send({
			type: 'SELECT',
			scope: { ...f.scope, attachment: {} },
			request: { workspaceId: 'a', attempt: 1 }
		})
		expect(f.actor.getSnapshot().context.request).toBeUndefined()
		f.select()
		const original = f.observe('denied', 5)
		for (const observation of [
			{ ...original, access: 'allowed', generation: 4 },
			{ ...original, access: 'allowed', generation: 5 },
			{ ...original, access: 'allowed', generation: NaN },
			{ ...original, access: 'allowed', generation: 6, scope: { ...f.scope, binding: {} } },
			{ ...original, access: 'allowed', generation: 6, scope: { ...f.scope, attachment: {} } },
			{ ...original, access: 'allowed', generation: 6, request: { workspaceId: 'b', attempt: 1 } },
			{ ...original, access: 'allowed', generation: 6, request: { workspaceId: 'a', attempt: 2 } }
		] satisfies WorkspaceSelectionObservation[])
			f.actor.send({ type: 'OBSERVED', observation })
		expect(status(f)).toBe('denied')
		f.observe('allowed', 6)
		expect(f.lease().epoch).toBe(1)
	})
	it('updates allowed observations without replacing the lease or draining', () => {
		const f = fixture()
		f.activate()
		const lease = f.lease()
		f.observe('allowed', 1, { status: 'loading' })
		expect(f.lease()).toBe(lease)
		expect(f.reports.filter((r) => r.type === 'WORKSPACE_DRAIN_REQUESTED')).toHaveLength(0)
	})
	it.each([
		'unknown',
		'denied',
		'unavailable',
		'failed'
	] satisfies WorkspaceSelectionObservation['access'][])(
		'invalidates before requesting drain on %s and cannot replay a prior grant',
		(access) => {
			const f = fixture()
			f.activate()
			const granted = f.observation('allowed', 0)
			const before = f.reports.length
			f.observe(access, 1)
			expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
			expect(f.reports.slice(before).map((r) => r.type)).toEqual([
				'WORKSPACE_SCOPE_INVALIDATED',
				'WORKSPACE_DRAIN_REQUESTED'
			])
			f.actor.send({ type: 'OBSERVED', observation: granted })
			f.actor.send({ type: 'DRAINED', drain: f.drain() })
			expect(status(f)).toBe(access === 'unknown' ? 'waiting' : access)
			expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
		}
	)
	it('retains only the latest selection intent while preserving the issued drain', () => {
		const f = fixture()
		f.activate('a')
		const originalLease = f.lease()
		f.select('b')
		const drain = f.drain()
		f.observe()
		f.select('c')
		f.observe()
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
		expect(f.drain()).toBe(drain)
		expect(drain.lease).toBe(originalLease)
		expect(f.reports.filter((r) => r.type === 'WORKSPACE_DRAIN_REQUESTED')).toHaveLength(1)
		f.actor.send({ type: 'DRAINED', drain })
		expect(f.lease().request).toEqual({ workspaceId: 'c', attempt: 3 })
		expect(f.lease().epoch).toBe(2)
	})
	it('rejects stale A facts and old acknowledgements after A → B → A', () => {
		const f = fixture()
		f.activate('a')
		const old = f.observation('allowed', 900)
		f.select('b')
		const firstDrain = f.drain()
		f.select('a')
		f.actor.send({ type: 'OBSERVED', observation: old })
		f.actor.send({ type: 'DRAINED', drain: firstDrain })
		expect(status(f)).toBe('waiting')
		f.observe()
		expect(f.lease().request.attempt).toBe(3)
		f.actor.send({ type: 'SHUTDOWN' })
		const nextDrain = f.drain()
		expect(nextDrain.token).not.toBe(firstDrain.token)
		f.actor.send({ type: 'DRAINED', drain: firstDrain })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.actor.send({ type: 'DRAINED', drain: nextDrain })
		expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
	})
	it('rejects foreign token, binding, attachment, epoch, workspace, and attempt acknowledgements', () => {
		const f = fixture()
		f.activate()
		f.select('b')
		const drain = f.drain()
		const invalid: WorkspaceDrainRequest[] = [
			{ ...drain, token: {} },
			{ ...drain, lease: { ...drain.lease, scope: { ...f.scope, binding: {} } } },
			{ ...drain, lease: { ...drain.lease, scope: { ...f.scope, attachment: {} } } },
			{ ...drain, lease: { ...drain.lease, epoch: 0 } },
			{ ...drain, lease: { ...drain.lease, request: { workspaceId: 'other', attempt: 1 } } },
			{ ...drain, lease: { ...drain.lease, request: { workspaceId: 'a', attempt: 0 } } }
		]
		for (const stale of invalid) {
			f.actor.send({ type: 'DRAINED', drain: stale })
			f.actor.send({ type: 'DRAIN_FAILED', drain: stale, outcome: 'unresolved' })
		}
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.drain()).toBe(drain)
		f.observe()
		f.actor.send({ type: 'DRAINED', drain })
		expect(f.lease().request.workspaceId).toBe('b')
	})
	it('accepts a synchronous host acknowledgement without leaking the old scope', () => {
		const f = fixture(true, true)
		f.activate()
		f.select('b')
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
		f.observe()
		expect(f.lease().request.workspaceId).toBe('b')
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
	})
	it('suspends through the same drain and requires fresh explicit resume evidence', () => {
		const f = fixture()
		f.activate()
		f.actor.send({ type: 'SUSPEND', scope: f.scope })
		const drain = f.drain()
		f.actor.send({ type: 'RESUME', observation: f.observation('allowed', 1) })
		f.actor.send({ type: 'DRAINED', drain })
		expect(status(f)).toBe('suspended')
		f.observe('allowed', 1)
		f.actor.send({ type: 'RESUME', observation: f.observation('allowed', 1) })
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
		f.actor.send({ type: 'RESUME', observation: f.observation('allowed', 2) })
		expect(f.lease().epoch).toBe(2)
	})
	it('suspends before selection and never treats ordinary observations as resume', () => {
		const f = fixture()
		f.actor.send({ type: 'SUSPEND', scope: f.scope })
		f.select()
		f.observe()
		expect(status(f)).toBe('suspended')
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
		f.actor.send({ type: 'RESUME', observation: f.observation('allowed', 1) })
		expect(f.lease().epoch).toBe(1)
	})
	it.each(['switching', 'suspending', 'closing'])(
		'preserves shutdown priority from %s while waiting for the exact drain',
		(phase) => {
			const f = fixture()
			f.activate()
			if (phase === 'switching') f.select('b')
			else if (phase === 'suspending') f.actor.send({ type: 'SUSPEND', scope: f.scope })
			else f.actor.send({ type: 'SHUTDOWN' })
			const drain = f.drain()
			f.actor.send({ type: 'SHUTDOWN' })
			f.select('c')
			f.observe()
			f.actor.send({ type: 'SUSPEND', scope: f.scope })
			f.actor.send({ type: 'RESUME', observation: f.observation('allowed', 5) })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.drain()).toBe(drain)
			f.actor.send({ type: 'DRAINED', drain })
			expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
			expect(f.actor.getSnapshot().context.scope).toBeUndefined()
			expect(f.actor.getSnapshot().context.observation).toBeUndefined()
			expect(f.actor.getSnapshot().context.drain).toBeUndefined()
		}
	)
	it('keeps suspension priority and one drain token across rapid selection', () => {
		const f = fixture()
		f.activate()
		f.select('b')
		const drain = f.drain()
		f.actor.send({ type: 'SUSPEND', scope: f.scope })
		f.select('c')
		f.observe()
		expect(f.drain()).toBe(drain)
		f.actor.send({ type: 'DRAINED', drain })
		expect(status(f)).toBe('suspended')
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
		f.actor.send({ type: 'RESUME', observation: f.observation('allowed', 1) })
		expect(f.lease().request.workspaceId).toBe('c')
	})
	it('ignores duplicate intent and foreign suspension without disrupting a healthy lease', () => {
		const f = fixture()
		f.activate()
		const lease = f.lease()
		f.actor.send({ type: 'SELECT', scope: f.scope, request: lease.request })
		f.actor.send({ type: 'SUSPEND', scope: { ...f.scope, attachment: {} } })
		expect(f.lease()).toBe(lease)
		expect(f.reports.some((r) => r.type === 'WORKSPACE_DRAIN_REQUESTED')).toBe(false)
	})
	it('requires explicit fresh retry after release with failure', () => {
		const f = fixture()
		f.activate()
		f.select('b')
		f.observe()
		f.actor.send({ type: 'DRAIN_FAILED', drain: f.drain(), outcome: 'released' })
		expect(status(f)).toBe('drainFailed')
		f.select('c')
		f.observe()
		f.actor.send({ type: 'SUSPEND', scope: f.scope })
		f.actor.send({ type: 'RESUME', observation: f.observation('allowed', 1) })
		f.actor.send({ type: 'RETRY', observation: f.observation('allowed', 0) })
		expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
		f.actor.send({ type: 'RETRY', observation: f.observation('allowed', 1) })
		expect(f.lease().request.workspaceId).toBe('c')
	})
	it.each([false, true])(
		'closes honestly after released-with-failure (already closing: %s)',
		(closing) => {
			const f = fixture()
			f.activate()
			if (closing) f.actor.send({ type: 'SHUTDOWN' })
			else f.select('b')
			f.actor.send({ type: 'DRAIN_FAILED', drain: f.drain(), outcome: 'released' })
			if (!closing) f.actor.send({ type: 'SHUTDOWN' })
			expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
			expect(
				f.reports.some((r) => r.type === 'WORKSPACE_DRAIN_FAILED' && r.outcome === 'released')
			).toBe(true)
		}
	)
	it.each([false, true])(
		'retains unresolved drain identity without a clean replacement (closing: %s)',
		(closing) => {
			const f = fixture()
			f.activate()
			if (closing) f.actor.send({ type: 'SHUTDOWN' })
			else f.select('b')
			const drain = f.drain()
			f.actor.send({ type: 'DRAIN_FAILED', drain, outcome: 'unresolved' })
			f.actor.send({ type: 'SHUTDOWN' })
			f.actor.send({ type: 'DRAINED', drain })
			f.select('c')
			f.observe()
			expect(f.actor.getSnapshot().output).toEqual({ outcome: 'unresolved', drain })
			expect(selectWorkspaceLease(f.actor.getSnapshot())).toBeUndefined()
			expect(f.actor.getSnapshot().context.observation).toBeUndefined()
		}
	)
})
