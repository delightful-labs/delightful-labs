import { afterEach, describe, expect, it, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import type {
	InternalTransferCreateInput,
	InternalTransferCreateResult
} from './internal-transfer-create.js'
import type {
	InternalTransferLinkInput,
	InternalTransferLinkResult,
	InternalTransferUnlinkInput,
	InternalTransferUnlinkResult,
	InternalTransferDeleteInput,
	InternalTransferDeleteResult
} from './internal-transfer.js'
import type {
	TransferMutationScope,
	TransferScopeDrainRequest,
	TransferScopeDrainResponse
} from '../../contracts/transfer-scope-drain.js'
import {
	createInternalTransferMutationOwner,
	type TransferMutationRequest,
	type TransferMutationResponse
} from './internal-transfer-mutation-owner.js'
import { createActor, setup, waitFor, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

// Replace only operation-machine exports at runtime; keep the real owner and its typed public protocol.
const controls: {
	create: ReturnType<typeof controlled<InternalTransferCreateResult>> | undefined
	link: ReturnType<typeof controlled<InternalTransferLinkResult>> | undefined
	unlink: ReturnType<typeof controlled<InternalTransferUnlinkResult>> | undefined
	delete: ReturnType<typeof controlled<InternalTransferDeleteResult>> | undefined
} = vi.hoisted(() => ({ create: undefined, link: undefined, unlink: undefined, delete: undefined }))
vi.mock('./internal-transfer-create.js', async (original) => {
	const actual = await original<typeof import('./internal-transfer-create.js')>()
	return {
		...actual,
		createInternalTransferCreateMachine: () =>
			controls.create?.logic ?? actual.createInternalTransferCreateMachine()
	}
})
vi.mock('./internal-transfer.js', async (original) => {
	const actual = await original<typeof import('./internal-transfer.js')>()
	return {
		...actual,
		get internalTransferLinkMachine() {
			return controls.link?.logic ?? actual.internalTransferLinkMachine
		},
		get internalTransferUnlinkMachine() {
			return controls.unlink?.logic ?? actual.internalTransferUnlinkMachine
		},
		get internalTransferDeleteMachine() {
			return controls.delete?.logic ?? actual.internalTransferDeleteMachine
		}
	}
})
const workspaceId = '11111111-1111-4111-8111-111111111111'
const identityId = '22222222-2222-4222-8222-222222222222'
const expenseId = '33333333-3333-4333-8333-333333333333'
const incomeId = '44444444-4444-4444-8444-444444444444'
const transferId = '55555555-5555-4555-8555-555555555555'
const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})

function controlled<Output>() {
	const pending = Promise.withResolvers<Output>()
	let result: Output | undefined
	const shutdown = vi.fn()
	const invoked = vi.fn()
	const finish = createAsyncLogic({
		run: () => {
			invoked()
			return pending.promise
		}
	})
	const events1 = { SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>() }
	type NativeEvent1 =
		| import('xstate').InferEvents<typeof events1>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof finish>>
		| import('xstate').ErrorActorEvent
	const logic = setup({
		schemas: {
			context: types<{}>(),
			events: events1,
			input: types<unknown>(),
			output: types<Output>(),
			children: {
				finish: types<import('xstate').ActorRefFrom<{ finish: typeof finish }['finish']>>()
			}
		},
		actors: { finish }
	}).createMachine({
		context: {},
		initial: 'issued',
		output: () => {
			if (result === undefined) throw new Error('Missing controlled output')
			return result
		},
		on: {
			SHUTDOWN: (_, enq) => {
				enq(shutdown)
			}
		},
		states: {
			issued: {
				invoke: {
					src: 'finish',
					onDone: { target: 'complete' },
					onError: (args, enq) => {
						enq(({ event }) => {
							throw event.error
						}, args)
					}
				}
			},
			complete: { type: 'final' }
		}
	})
	return {
		logic,
		pending: {
			...pending,
			resolve: (value: Output) => {
				result = value
				pending.resolve(value)
			}
		},
		shutdown,
		invoked
	}
}
function fixture(bind = true, definition?: ReturnType<typeof createInternalTransferMutationOwner>) {
	const gates = {
		create: controlled<InternalTransferCreateResult>(),
		link: controlled<InternalTransferLinkResult>(),
		unlink: controlled<InternalTransferUnlinkResult>(),
		delete: controlled<InternalTransferDeleteResult>()
	}
	Object.assign(controls, gates)
	const owner = definition ?? createInternalTransferMutationOwner()
	const closed = vi.fn()
	const events0 = {
		TRANSFER_MUTATION_OWNER_CLOSED:
			types<
				EventPayload<{ type: 'TRANSFER_MUTATION_OWNER_CLOSED' }, 'TRANSFER_MUTATION_OWNER_CLOSED'>
			>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof owner>>
		| import('xstate').ErrorActorEvent
	const parentLogic = setup({
		schemas: {
			context: types<{}>(),
			events: events0,
			children: { owner: types<import('xstate').ActorRefFrom<{ owner: typeof owner }['owner']>>() }
		},
		actors: { owner }
	}).createMachine({
		context: {},
		invoke: { id: 'owner', src: 'owner' },
		initial: 'live',
		states: { live: {} },
		on: {
			TRANSFER_MUTATION_OWNER_CLOSED: (_, enq) => {
				enq(closed)
			}
		}
	})
	const parent = createActor(parentLogic).start()
	actors.add(parent)
	const actor = parent.getSnapshot().children.owner
	if (!actor) throw new Error('Missing owner')
	const scope = { binding: {}, workspaceId, generation: 0 }
	if (bind) actor.send({ type: 'BIND_TRANSFER_SCOPE', scope })
	const reports: TransferScopeDrainResponse[] = []
	const mutations: TransferMutationResponse[] = []
	const recipient = { send: (event: TransferScopeDrainResponse) => reports.push(event) }
	const tx = new Transaction('mergeable', () => {
		throw new Error('No runtime in controlled owner test')
	})
	const db = { beginTransaction: vi.fn(() => tx) }
	const endpointDb = {
		one: async () => null,
		all: async () => [],
		transaction: vi.fn<InternalTransferDeleteInput['db']['transaction']>(),
		delete: vi.fn<InternalTransferUnlinkInput['db']['delete']>()
	}
	function request(
		operation: TransferMutationRequest['operation'] = 'link',
		requestId = 'issued',
		selectedScope: TransferMutationScope = scope
	): TransferMutationRequest {
		const common = {
			requestId,
			workspaceId: selectedScope.workspaceId,
			scope: selectedScope,
			recipient: { send: (event: TransferMutationResponse) => mutations.push(event) }
		}
		const endpoints = {
			organizationId: selectedScope.workspaceId,
			identityId,
			expenseTransactionId: expenseId,
			incomeTransactionId: incomeId,
			trackWrite: vi.fn()
		}
		if (operation === 'create')
			return {
				...common,
				operation,
				input: {
					db,
					organizationId: selectedScope.workspaceId,
					identityId,
					expenseAccountId: expenseId,
					incomeAccountId: incomeId,
					expenseAmountMinor: 100,
					incomeAmountMinor: 100,
					expenseCurrency: 'USD',
					incomeCurrency: 'USD',
					bookedOn: '2026-10-25',
					trackWrite: vi.fn()
				}
			}
		if (operation === 'link') return { ...common, operation, input: { ...endpoints, db } }
		if (operation === 'unlink')
			return { ...common, operation, input: { ...endpoints, transferId, db: endpointDb } }
		return {
			...common,
			operation,
			input: { ...endpoints, transferId, db: endpointDb, choice: { kind: 'both' } }
		}
	}
	function drain(
		selectedScope: TransferMutationScope = scope,
		token = {}
	): TransferScopeDrainRequest {
		return { request: { scope: selectedScope, token }, recipient }
	}
	return {
		actor,
		parent,
		gates,
		scope,
		reports,
		mutations,
		recipient,
		closed,
		db,
		request,
		drain,
		issue: (operation: TransferMutationRequest['operation'] = 'link') =>
			actor.send({ type: 'REQUEST_TRANSFER_MUTATION', request: request(operation) })
	}
}
async function idle(f: ReturnType<typeof fixture>) {
	await waitFor(f.actor, (snapshot) => snapshot.matches({ running: { work: 'idle' } }))
}
async function reported(f: ReturnType<typeof fixture>) {
	await waitFor(f.actor, () => f.reports.length > 0)
}
const operations = [
	'create',
	'link',
	'unlink',
	'delete'
] satisfies TransferMutationRequest['operation'][]

describe('scoped transfer drain ownership', () => {
	it('binds lazily and releases an idle scope without an operation', () => {
		const f = fixture()
		const drain = f.drain()
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain })
		expect(f.reports).toEqual([
			{ type: 'TRANSFER_SCOPE_DRAIN_RESULT', request: drain.request, outcome: 'released' }
		])
		expect(f.actor.getSnapshot().matches({ running: { control: 'released' } })).toBe(true)
		for (const gate of Object.values(f.gates)) expect(gate.invoked).not.toHaveBeenCalled()
	})
	it.each(operations)(
		'retains issued %s until settlement and rejects queued and new work',
		async (operation) => {
			const f = fixture()
			f.issue(operation)
			f.actor.send({ type: 'REQUEST_TRANSFER_MUTATION', request: f.request('link', 'queued') })
			const drain = f.drain()
			f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain })
			f.actor.send({ type: 'REQUEST_TRANSFER_MUTATION', request: f.request('link', 'late') })
			expect(f.gates[operation].shutdown).toHaveBeenCalledOnce()
			expect(f.reports).toEqual([])
			expect(f.mutations.map((r) => r.requestId)).toEqual(['queued', 'late'])
			f.gates[operation].pending.resolve({ outcome: 'closed', settlement: 'notStarted' })
			await reported(f)
			expect(f.reports[0]?.outcome).toBe('released')
			expect(f.mutations.map((r) => r.requestId)).toEqual(['queued', 'late', 'issued'])
			expect(f.actor.getSnapshot().status).toBe('active')
			f.actor.send({
				type: 'REQUEST_TRANSFER_MUTATION',
				request: f.request('link', 'before-rebind')
			})
			expect(f.mutations.at(-1)?.requestId).toBe('before-rebind')
			expect(f.mutations.at(-1)?.result.result.settlement).toBe('notStarted')
		}
	)
	it.each(operations)('preserves shutdown during a scoped %s drain', async (operation) => {
		const f = fixture()
		f.issue(operation)
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: { ...f.scope, generation: 1 } })
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.closed).not.toHaveBeenCalled()
		f.gates[operation].pending.resolve({ outcome: 'closed', settlement: 'notStarted' })
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.reports[0]?.outcome).toBe('released')
		expect(f.closed).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
	})
	it('accepts an exact drain while shutdown is retaining an issued operation', async () => {
		const f = fixture()
		f.issue()
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
		expect(f.reports).toEqual([])
		f.gates.link.pending.resolve({ outcome: 'closed', settlement: 'notStarted' })
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.reports[0]?.outcome).toBe('released')
		expect(f.closed).toHaveBeenCalledOnce()
	})
	it('does not replace a pending drain token or recipient and replays only its completed response', async () => {
		const f = fixture()
		f.issue()
		const drain = f.drain()
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain })
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain })
		expect(f.gates.link.shutdown).toHaveBeenCalledOnce()
		expect(f.reports).toEqual([])
		const foreign: TransferScopeDrainResponse[] = []
		f.actor.send({
			type: 'DRAIN_TRANSFER_SCOPE',
			drain: { ...drain, recipient: { send: (e) => foreign.push(e) } }
		})
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
		expect(foreign[0]).toMatchObject({ outcome: 'rejected', reason: 'busy' })
		expect(f.reports[0]).toMatchObject({ outcome: 'rejected', reason: 'busy' })
		f.gates.link.pending.resolve({ outcome: 'closed', settlement: 'notStarted' })
		await waitFor(f.actor, () => f.reports.some((r) => r.outcome === 'released'))
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain })
		expect(f.reports.filter((r) => r.outcome === 'released')).toHaveLength(2)
	})
	it('rejects mismatched scope and invalid or stale binding generations', () => {
		const f = fixture(false)
		for (const generation of [-1, NaN, Infinity, 0.5])
			f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: { ...f.scope, generation } })
		expect(f.actor.getSnapshot().context.scope).toBeUndefined()
		f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: f.scope })
		for (const scope of [
			{ ...f.scope, binding: {} },
			{ ...f.scope, generation: 1 },
			{ ...f.scope, workspaceId: 'other' }
		])
			f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain(scope) })
		expect(f.reports).toHaveLength(3)
		for (const report of f.reports)
			expect(report).toMatchObject({ outcome: 'rejected', reason: 'scopeMismatch' })
		f.actor.send({ type: 'TRANSFER_SCOPE_CHANGED', workspaceId: 'other' })
		expect(f.actor.getSnapshot().context.scope).toEqual(f.scope)
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
		f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: { ...f.scope, binding: {} } })
		expect(f.actor.getSnapshot().matches({ running: { control: 'released' } })).toBe(true)
	})
	it('rejects old A requests and retired tokens after A → B → A', () => {
		const f = fixture()
		const oldRequest = f.request()
		const first = f.drain()
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: first })
		const b = { ...f.scope, workspaceId: 'b', generation: 1 }
		f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: b })
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain(b) })
		const a = { ...f.scope, generation: 2 }
		f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: a })
		f.actor.send({ type: 'REQUEST_TRANSFER_MUTATION', request: oldRequest })
		const unscoped = { ...oldRequest }
		delete unscoped.scope
		f.actor.send({ type: 'REQUEST_TRANSFER_MUTATION', request: unscoped })
		expect(f.gates.link.invoked).not.toHaveBeenCalled()
		expect(f.mutations).toHaveLength(2)
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain(a, first.request.token) })
		expect(f.reports.at(-1)).toMatchObject({ outcome: 'rejected', reason: 'retired' })
	})
	it.each(operations)(
		'reports a crashed %s child as unresolved without a clean close notice',
		async (operation) => {
			const f = fixture()
			f.issue(operation)
			const drain = f.drain()
			f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain })
			f.gates[operation].pending.reject(new Error('PRIVATE_CHILD_CRASH'))
			await waitFor(f.actor, (s) => s.status === 'done')
			expect(f.reports.at(-1)).toMatchObject({ outcome: 'unresolved', request: drain.request })
			expect(f.closed).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().output).toEqual({
				outcome: 'unresolved',
				scope: f.scope,
				drain: drain.request
			})
			expect(JSON.stringify(f.actor.getSnapshot().context)).not.toContain('PRIVATE_CHILD_CRASH')
		}
	)
	it('remembers uncertainty after idle and rejects queued work before a later drain', async () => {
		const f = fixture()
		f.issue()
		f.actor.send({ type: 'REQUEST_TRANSFER_MUTATION', request: f.request('link', 'queued') })
		f.gates.link.pending.resolve({
			outcome: 'unavailable',
			settlement: 'unresolved',
			error: new Error('PRIVATE_SETTLEMENT')
		})
		await idle(f)
		expect(f.gates.link.invoked).toHaveBeenCalledOnce()
		expect(f.mutations.map((r) => r.requestId)).toEqual(['issued', 'queued'])
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
		expect(f.actor.getSnapshot().output?.outcome).toBe('unresolved')
		expect(f.actor.getSnapshot().context.scopeResult).toBeUndefined()
		expect(JSON.stringify(f.actor.getSnapshot().context)).not.toContain('PRIVATE_SETTLEMENT')
	})
	it('reports unresolved shutdown even without a drain request', async () => {
		const f = fixture()
		f.issue()
		f.actor.send({ type: 'SHUTDOWN' })
		f.gates.link.pending.resolve({ outcome: 'closed', settlement: 'unresolved' })
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.actor.getSnapshot().output).toEqual({
			outcome: 'unresolved',
			scope: f.scope,
			drain: undefined
		})
		expect(f.closed).not.toHaveBeenCalled()
	})
	it.each(['unlink', 'delete'] satisfies ('unlink' | 'delete')[])(
		'reports locally persisted recoveryRequired for %s as releasedWithFailure',
		async (operation) => {
			const f = fixture()
			f.issue(operation)
			f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
			if (operation === 'unlink')
				f.gates.unlink.pending.resolve({
					outcome: 'recoveryRequired',
					transferId,
					settlement: 'locallyPersisted'
				})
			else
				f.gates.delete.pending.resolve({
					outcome: 'recoveryRequired',
					transferId,
					settlement: 'locallyPersisted',
					choice: { kind: 'both' },
					phase: 'deletingRecords'
				})
			await reported(f)
			expect(f.reports.at(-1)?.outcome).toBe('releasedWithFailure')
			expect(f.actor.getSnapshot().matches({ running: { control: 'released' } })).toBe(true)
		}
	)
})

describe('scope drain recovery facts and independent lifetimes', () => {
	it('keeps retired token sets independent for actors sharing a definition', () => {
		const definition = createInternalTransferMutationOwner()
		const first = fixture(true, definition),
			second = fixture(true, definition)
		const token = {}
		first.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: first.drain(first.scope, token) })
		second.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: second.drain(second.scope, token) })
		expect(first.reports[0]?.outcome).toBe('released')
		expect(second.reports[0]?.outcome).toBe('released')
	})
	it('accepts reentrant host binding only after reporting release', () => {
		const f = fixture()
		const next = { ...f.scope, generation: 1 }
		f.actor.send({
			type: 'DRAIN_TRANSFER_SCOPE',
			drain: {
				request: f.drain().request,
				recipient: {
					send: (event) => {
						f.reports.push(event)
						f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: next })
					}
				}
			}
		})
		expect(f.reports[0]?.outcome).toBe('released')
		expect(f.actor.getSnapshot().context.scope).toEqual(next)
		expect(f.actor.getSnapshot().matches({ running: { control: 'active', work: 'idle' } })).toBe(
			true
		)
	})
	it('lets uncertainty dominate earlier locally persisted partial progress', async () => {
		const f = fixture()
		f.issue('unlink')
		f.gates.unlink.pending.resolve({
			outcome: 'recoveryRequired',
			transferId,
			settlement: 'locallyPersisted'
		})
		await idle(f)
		f.issue('link')
		f.gates.link.pending.resolve({ outcome: 'unavailable', settlement: 'unresolved' })
		await idle(f)
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
		expect(f.reports.at(-1)?.outcome).toBe('unresolved')
	})
	it('cannot erase unresolved legacy work with a first scoped binding', async () => {
		const f = fixture(false)
		f.actor.send({ type: 'TRANSFER_SCOPE_CHANGED', workspaceId })
		const legacy = f.request()
		delete legacy.scope
		f.actor.send({ type: 'REQUEST_TRANSFER_MUTATION', request: legacy })
		f.gates.link.pending.resolve({ outcome: 'unavailable', settlement: 'unresolved' })
		await idle(f)
		f.actor.send({ type: 'BIND_TRANSFER_SCOPE', scope: f.scope })
		expect(f.actor.getSnapshot().context.scope).toBeUndefined()
		f.actor.send({ type: 'DRAIN_TRANSFER_SCOPE', drain: f.drain() })
		expect(f.reports[0]).toMatchObject({ outcome: 'rejected', reason: 'scopeMismatch' })
	})
})
