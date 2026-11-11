import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor, createAsyncLogic } from 'xstate'
import { createInvitationRedemptionMachine } from './invitation-redemption.js'
import type {
	InvitationCapability,
	InvitationDecision,
	InvitationEvent,
	InvitationRequest,
	InvitationSettlement
} from '../../contracts/workspace-invitation.js'

type Scope = { binding: object; generation: number }
type Capability = InvitationCapability<Scope>
const active = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of active) actor.stop()
	active.clear()
})
const joined: InvitationDecision = { outcome: 'joined', membershipId: 'membership' }
const decisions: InvitationDecision[] = [
	joined,
	{ outcome: 'alreadyMember', membershipId: 'existing' },
	{ outcome: 'invalid' },
	{ outcome: 'expired' },
	{ outcome: 'used' },
	{ outcome: 'revoked' },
	{ outcome: 'denied' }
]
const interruptions = [
	{ type: 'CANCEL', outcome: 'cancelled' },
	{ type: 'INVALIDATE', outcome: 'scopeChanged' },
	{ type: 'SHUTDOWN', outcome: 'closed' }
] satisfies { type: InvitationEvent['type']; outcome: 'cancelled' | 'scopeChanged' | 'closed' }[]
function deferred<Value>() {
	let resolve!: (value: Value) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<Value>((accept, fail) => {
		resolve = accept
		reject = fail
	})
	return { promise, resolve, reject }
}
function fixture(change: Partial<InvitationRequest<Scope>> = {}) {
	const request: InvitationRequest<Scope> = {
		operationId: 'attempt',
		invitationId: 'invite',
		scope: { binding: {}, generation: 4 },
		code: ' synthetic-code ',
		...change
	}
	const capability = {
		assess: vi.fn<Capability['assess']>(() => ({ kind: 'ready' })),
		redeem: vi.fn<Capability['redeem']>(async () => joined)
	}
	const actor = createActor(createInvitationRedemptionMachine<Scope>(), {
		input: { request, capability }
	})
	active.add(actor)
	return {
		actor,
		request,
		capability,
		issued: () =>
			waitFor(actor, (s) => s.matches({ redeeming: { request: 'pending' } }), { timeout: 1000 }),
		done: () => waitFor(actor, (s) => s.status === 'done', { timeout: 1000 })
	}
}
function assertCleared(
	snapshot: ReturnType<ReturnType<typeof fixture>['actor']['getSnapshot']>,
	code: string
) {
	expect(snapshot.context.request).toBeUndefined()
	expect(snapshot.context.capability).toBeUndefined()
	expect(Object.keys(snapshot.children)).toHaveLength(0)
	expect(JSON.stringify(snapshot.context)).not.toContain(code)
	expect(JSON.stringify(snapshot.output)).not.toContain(code)
}

describe('invitation redemption', () => {
	it('keeps the original issued identity and code when the caller mutates its request', async () => {
		const f = fixture()
		const request = { ...f.request }
		const original = { ...request }
		const actor = createActor(createInvitationRedemptionMachine<Scope>(), {
			input: { request, capability: f.capability }
		})
		active.add(actor)
		actor.start()
		request.operationId = 'replacement-operation'
		request.invitationId = 'replacement-invitation'
		request.code = 'replacement-code'
		const snapshot = await waitFor(actor, (value) => value.status === 'done', { timeout: 1000 })
		expect(f.capability.redeem).toHaveBeenCalledExactlyOnceWith(original)
		expect(snapshot.output).toMatchObject({
			operationId: original.operationId,
			invitationId: original.invitationId,
			outcome: 'completed'
		})
		expect(snapshot.output?.scope).toBe(original.scope)
		assertCleared(snapshot, original.code)
	})

	it.each(decisions)(
		'retains the authority $outcome decision without interpreting refusal as membership',
		async (decision) => {
			const f = fixture()
			f.capability.redeem.mockResolvedValue(decision)
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toEqual({
				operationId: 'attempt',
				invitationId: 'invite',
				scope: f.request.scope,
				outcome: 'completed',
				settlement: { kind: 'confirmed', decision }
			})
			expect(f.capability.assess).toHaveBeenCalledExactlyOnceWith({
				operationId: 'attempt',
				invitationId: 'invite',
				scope: f.request.scope
			})
			expect(f.capability.redeem).toHaveBeenCalledExactlyOnceWith(f.request)
			expect(snapshot.output?.scope).toBe(f.request.scope)
			expect(f.request.code).toBe(' synthetic-code ')
			assertCleared(snapshot, f.request.code)
		}
	)
	it.each([{ operationId: ' ' }, { invitationId: ' ' }, { code: ' \t ' }])(
		'rejects malformed request %j before assessment or transport',
		async (change) => {
			const f = fixture(change)
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'invalid',
				settlement: { kind: 'notStarted' }
			})
			expect(f.capability.assess).not.toHaveBeenCalled()
			expect(f.capability.redeem).not.toHaveBeenCalled()
			assertCleared(snapshot, f.request.code)
		}
	)
	it.each(['sessionUnavailable', 'authorityUnavailable'] satisfies (
		| 'sessionUnavailable'
		| 'authorityUnavailable'
	)[])('blocks %s before transport', async (reason) => {
		const f = fixture()
		f.capability.assess.mockReturnValue({ kind: 'blocked', reason })
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			outcome: 'blocked',
			reason,
			settlement: { kind: 'notStarted' }
		})
		expect(f.capability.redeem).not.toHaveBeenCalled()
		assertCleared(snapshot, f.request.code)
	})
	it('sanitizes assessment exceptions without issuing', async () => {
		const f = fixture()
		f.capability.assess.mockImplementation(() => {
			throw new Error(f.request.code)
		})
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'notStarted' } })
		expect(f.capability.redeem).not.toHaveBeenCalled()
		assertCleared(snapshot, f.request.code)
	})
	it.each(interruptions)(
		'handles $type before issue and ignores the late assessment completion',
		async ({ type, outcome }) => {
			const f = fixture()
			f.actor.start()
			f.actor.send({ type })
			const snapshot = await f.done()
			await Promise.resolve()
			expect(snapshot.output).toMatchObject({ outcome, settlement: { kind: 'notStarted' } })
			expect(f.capability.redeem).not.toHaveBeenCalled()
			assertCleared(snapshot, f.request.code)
		}
	)
	it.each(interruptions)(
		'drains $type after issue and preserves confirmed settlement',
		async ({ type, outcome }) => {
			const f = fixture()
			const pending = deferred<InvitationDecision>()
			f.capability.redeem.mockReturnValue(pending.promise)
			f.actor.start()
			await f.issued()
			f.actor.send({ type })
			f.actor.send({ type })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.capability.redeem).toHaveBeenCalledOnce()
			pending.resolve(joined)
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome,
				settlement: { kind: 'confirmed', decision: joined }
			})
			assertCleared(snapshot, f.request.code)
		}
	)
	it.each(interruptions)(
		'drains $type after issue and preserves an unknown outcome',
		async ({ type, outcome }) => {
			const f = fixture()
			const pending = deferred<InvitationDecision>()
			f.capability.redeem.mockReturnValue(pending.promise)
			f.actor.start()
			await f.issued()
			f.actor.send({ type })
			expect(f.actor.getSnapshot().status).toBe('active')
			pending.reject(new Error(f.request.code))
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({ outcome, settlement: { kind: 'unknown' } })
			expect(f.capability.redeem).toHaveBeenCalledOnce()
			assertCleared(snapshot, f.request.code)
		}
	)
	it.each([
		['CANCEL', 'INVALIDATE', 'SHUTDOWN'],
		['CANCEL', 'SHUTDOWN', 'INVALIDATE'],
		['INVALIDATE', 'CANCEL', 'SHUTDOWN'],
		['INVALIDATE', 'SHUTDOWN', 'CANCEL'],
		['SHUTDOWN', 'CANCEL', 'INVALIDATE'],
		['SHUTDOWN', 'INVALIDATE', 'CANCEL']
	] satisfies InvitationEvent['type'][][])(
		'shutdown wins through interruption order %j',
		async (...events) => {
			const f = fixture()
			const pending = deferred<InvitationDecision>()
			f.capability.redeem.mockReturnValue(pending.promise)
			f.actor.start()
			await f.issued()
			for (const type of events) f.actor.send({ type })
			pending.resolve(joined)
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'closed',
				settlement: { kind: 'confirmed', decision: joined }
			})
			assertCleared(snapshot, f.request.code)
		}
	)
	it.each([
		['CANCEL', 'INVALIDATE'],
		['INVALIDATE', 'CANCEL']
	] satisfies InvitationEvent['type'][][])(
		'scope invalidation outranks cancellation %j',
		async (...events) => {
			const f = fixture()
			const pending = deferred<InvitationDecision>()
			f.capability.redeem.mockReturnValue(pending.promise)
			f.actor.start()
			await f.issued()
			for (const type of events) f.actor.send({ type })
			pending.resolve(joined)
			expect((await f.done()).output).toMatchObject({
				outcome: 'scopeChanged',
				settlement: { kind: 'confirmed' }
			})
		}
	)
	it('does not retry an exception or report that an issued request never started', async () => {
		const f = fixture()
		f.capability.redeem.mockRejectedValue(new Error(f.request.code))
		f.actor.start()
		const snapshot = await f.done()
		f.actor.send({ type: 'CANCEL' })
		await Promise.resolve()
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'unknown' } })
		expect(f.capability.redeem).toHaveBeenCalledOnce()
		assertCleared(snapshot, f.request.code)
	})
	it('contains an unexpected child failure without exposing backend exception text', async () => {
		const request: InvitationRequest<Scope> = {
			operationId: 'unexpected',
			invitationId: 'invite',
			scope: { binding: {}, generation: 5 },
			code: 'synthetic-failure-material'
		}
		const capability: Capability = { assess: () => ({ kind: 'ready' }), redeem: async () => joined }
		const logic = createInvitationRedemptionMachine<Scope>().provide({
			actors: {
				redeem: createAsyncLogic<
					Exclude<InvitationSettlement, { kind: 'notStarted' }>,
					{ request: InvitationRequest<Scope>; capability: Capability }
				>({
					run: async () => {
						throw new Error(request.code)
					}
				})
			}
		})
		const actor = createActor(logic, { input: { request, capability } })
		active.add(actor)
		actor.start()
		const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 1000 })
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'unknown' } })
		assertCleared(snapshot, request.code)
	})
})
