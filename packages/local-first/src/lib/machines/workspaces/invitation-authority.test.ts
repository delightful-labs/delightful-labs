import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor, createAsyncLogic } from 'xstate'
import { createInvitationAuthorityMachine } from './invitation-authority.js'
import type {
	InvitationAuthorityAdmission,
	InvitationAuthorityCapability,
	InvitationAuthorityEvent,
	InvitationAuthorityEvidence,
	InvitationAuthorityObservation,
	InvitationAuthorityRecords,
	InvitationAuthorityTransactions
} from '../../contracts/workspace-invitation-authority.js'

type Credentials = { bearer: string }
type Transaction = { token: object }
type Write = { token: object }
type Role = 'editor' | 'reader'
type Capability = InvitationAuthorityCapability<Credentials, Transaction, Write, Role>
type Transactions = InvitationAuthorityTransactions<Transaction, Write>
type Admission = InvitationAuthorityAdmission<Transaction, Write>
type Records = InvitationAuthorityRecords<Role>
type Phase =
	| 'admitting'
	| 'acquiring'
	| 'reading'
	| 'verifyingCode'
	| 'preparing'
	| 'staging'
	| 'committing'
	| 'confirming'
	| 'rollingBack'
const phases: Phase[] = [
	'admitting',
	'acquiring',
	'reading',
	'verifyingCode',
	'preparing',
	'staging',
	'committing',
	'confirming',
	'rollingBack'
]
const interruptions = [
	{ type: 'CANCEL', outcome: 'cancelled' },
	{ type: 'SHUTDOWN', outcome: 'closed' }
] satisfies { type: InvitationAuthorityEvent['type']; outcome: 'cancelled' | 'closed' }[]
const active = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of active) actor.stop()
	active.clear()
})
function deferred<Value>() {
	let resolve!: (value: Value) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<Value>((accept, fail) => {
		resolve = accept
		reject = fail
	})
	return { promise, resolve, reject }
}
function fixture(
	change: Partial<{ operationId: string; invitationId: string; code: string }> = {}
) {
	const transaction = { token: {} },
		write = { token: {} }
	const credentials = { bearer: 'synthetic-private-bearer' }
	const request = {
		operationId: 'operation',
		invitationId: 'invitation',
		code: 'synthetic-private-code',
		...change
	}
	const invitation: NonNullable<Records['invitation']> = {
		id: 'invitation',
		workspaceId: 'notebook',
		codeDigest: 'synthetic-private-digest',
		role: 'editor',
		expiresAt: 2000,
		revoked: false,
		consumed: null
	}
	const records: Records = { invitation, membership: null, evidence: null }
	const transactions = {
		retainDetached: vi.fn<Transactions['retainDetached']>(),
		open: vi.fn<Transactions['open']>(() => transaction),
		commit: vi.fn<Transactions['commit']>(() => ({ write })),
		confirm: vi.fn<Transactions['confirm']>(async () => {}),
		rollback: vi.fn<Transactions['rollback']>(async () => true)
	}
	const admission: Admission = { outcome: 'admitted', accountId: 'verified-reader', transactions }
	const capability = {
		admit: vi.fn<Capability['admit']>(() => admission),
		read: vi.fn<Capability['read']>(() => ({ outcome: 'observed', records })),
		verifyCode: vi.fn<Capability['verifyCode']>(async () => true),
		now: vi.fn<Capability['now']>(() => 1000),
		newMembershipId: vi.fn<Capability['newMembershipId']>(async () => 'new-membership'),
		stage: vi.fn<Capability['stage']>(async () => {})
	}
	const actor = createActor(createInvitationAuthorityMachine(capability), {
		input: { credentials, request }
	})
	active.add(actor)
	return {
		actor,
		transaction,
		write,
		credentials,
		request,
		records,
		invitation,
		transactions,
		admission,
		capability,
		observe: (patch: Partial<Records>) =>
			capability.read.mockReturnValue({ outcome: 'observed', records: { ...records, ...patch } }),
		done: () => waitFor(actor, (s) => s.status === 'done', { timeout: 1000 }),
		at: (phase: Phase) =>
			waitFor(actor, (s) => s.matches({ running: { work: phase } }), { timeout: 1000 })
	}
}
type Fixture = ReturnType<typeof fixture>
type Snapshot = ReturnType<Fixture['actor']['getSnapshot']>
function evidence(change: Partial<InvitationAuthorityEvidence> = {}): InvitationAuthorityEvidence {
	return {
		operationId: 'operation',
		invitationId: 'invitation',
		workspaceId: 'notebook',
		accountId: 'verified-reader',
		membershipId: 'existing-membership',
		...change
	}
}
const member = { id: 'existing-membership', workspaceId: 'notebook', accountId: 'verified-reader' }
function assertCleared(f: Fixture, snapshot: Snapshot) {
	const context = snapshot.context
	for (const field of [
		'request',
		'admission',
		'records',
		'now',
		'plan',
		'decision'
	] satisfies (keyof typeof context)[])
		expect(context[field]).toBeUndefined()
	for (const field of [
		'credentials',
		'transaction',
		'write'
	] satisfies (keyof typeof context.resources)[])
		expect(context.resources[field]).toBeUndefined()
	expect(Object.keys(snapshot.children)).toHaveLength(0)
	for (const secret of [f.credentials.bearer, 'synthetic-private-code', 'synthetic-private-digest'])
		expect(JSON.stringify(context)).not.toContain(secret)
}
function assertNoWrites(f: Fixture) {
	expect(f.capability.stage).not.toHaveBeenCalled()
	expect(f.transactions.commit).not.toHaveBeenCalled()
	expect(f.transactions.confirm).not.toHaveBeenCalled()
}
function pause(f: Fixture, phase: Phase) {
	const gates = {
		admitting: () => {
			const p = deferred<Admission>()
			f.capability.admit.mockReturnValue(p.promise)
			return () => p.resolve(f.admission)
		},
		acquiring: () => {
			const p = deferred<Transaction>()
			f.transactions.open.mockReturnValue(p.promise)
			return () => p.resolve(f.transaction)
		},
		reading: () => {
			const p = deferred<InvitationAuthorityObservation<Role>>()
			f.capability.read.mockReturnValue(p.promise)
			return () => p.resolve({ outcome: 'observed', records: f.records })
		},
		verifyingCode: () => {
			const p = deferred<boolean>()
			f.capability.verifyCode.mockReturnValue(p.promise)
			return () => p.resolve(true)
		},
		preparing: () => {
			const p = deferred<string>()
			f.capability.newMembershipId.mockReturnValue(p.promise)
			return () => p.resolve('new-membership')
		},
		staging: () => {
			const p = deferred<void>()
			f.capability.stage.mockReturnValue(p.promise)
			return () => p.resolve()
		},
		committing: () => {
			const p = deferred<{ write: Write }>()
			f.transactions.commit.mockReturnValue(p.promise)
			return () => p.resolve({ write: f.write })
		},
		confirming: () => {
			const p = deferred<void>()
			f.transactions.confirm.mockReturnValue(p.promise)
			return () => p.resolve()
		},
		rollingBack: () => {
			const p = deferred<boolean>()
			f.capability.verifyCode.mockResolvedValue(false)
			f.transactions.rollback.mockReturnValue(p.promise)
			return () => p.resolve(true)
		}
	}
	return gates[phase]()
}

describe('invitation authority resource owner', () => {
	it('stages one verified plan in one transaction and acknowledges only authority confirmation', async () => {
		const f = fixture(),
			confirmation = deferred<void>()
		f.transactions.confirm.mockReturnValue(confirmation.promise)
		f.actor.start()
		await f.at('confirming')
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.capability.admit).toHaveBeenCalledExactlyOnceWith(f.credentials)
		expect(f.capability.read).toHaveBeenCalledExactlyOnceWith(
			f.transaction,
			{ operationId: 'operation', invitationId: 'invitation' },
			'verified-reader'
		)
		expect(f.capability.verifyCode).toHaveBeenCalledExactlyOnceWith(
			'synthetic-private-code',
			'synthetic-private-digest'
		)
		expect(f.capability.stage).toHaveBeenCalledExactlyOnceWith(f.transaction, {
			operationId: 'operation',
			invitationId: 'invitation',
			accountId: 'verified-reader',
			workspaceId: 'notebook',
			membershipId: 'new-membership',
			role: 'editor',
			acceptedAt: 1000
		})
		expect(f.transactions.open).toHaveBeenCalledOnce()
		expect(f.transactions.commit).toHaveBeenCalledExactlyOnceWith(f.transaction)
		expect(f.transactions.confirm).toHaveBeenCalledExactlyOnceWith(f.write)
		expect(f.transactions.rollback).not.toHaveBeenCalled()
		confirmation.resolve()
		const snapshot = await f.done()
		expect(snapshot.output).toEqual({
			operationId: 'operation',
			invitationId: 'invitation',
			outcome: 'completed',
			settlement: {
				kind: 'confirmed',
				decision: { outcome: 'joined', membershipId: 'new-membership' }
			}
		})
		assertCleared(f, snapshot)
	})
	it('snapshots the original body before caller mutation during admission', async () => {
		const f = fixture(),
			release = pause(f, 'admitting')
		f.actor.start()
		await f.at('admitting')
		f.request.operationId = 'changed-operation'
		f.request.invitationId = 'changed-invitation'
		f.request.code = 'changed-code'
		release()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			operationId: 'operation',
			invitationId: 'invitation',
			outcome: 'completed'
		})
		expect(f.capability.verifyCode).toHaveBeenCalledWith(
			'synthetic-private-code',
			'synthetic-private-digest'
		)
		expect(f.capability.stage.mock.calls[0]?.[1]).toMatchObject({
			operationId: 'operation',
			invitationId: 'invitation'
		})
		assertCleared(f, snapshot)
	})
	it.each(['operationId', 'invitationId', 'code'] satisfies (keyof Fixture['request'])[])(
		'rejects empty %s before admission',
		async (field) => {
			const f = fixture({ [field]: ' ' })
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'invalidRequest',
				settlement: { kind: 'notStarted' }
			})
			expect(f.capability.admit).not.toHaveBeenCalled()
			expect(f.transactions.open).not.toHaveBeenCalled()
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it.each(['unauthenticated', 'unavailable'] satisfies ('unauthenticated' | 'unavailable')[])(
		'returns admission %s without acquiring a transaction',
		async (outcome) => {
			const f = fixture()
			f.capability.admit.mockReturnValue({ outcome })
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({ outcome, settlement: { kind: 'notStarted' } })
			expect(f.transactions.open).not.toHaveBeenCalled()
			assertCleared(f, snapshot)
		}
	)
	it('sanitizes an unexpected admission rejection', async () => {
		const f = fixture()
		f.capability.admit.mockImplementation(() => {
			throw new Error(f.credentials.bearer)
		})
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			outcome: 'unavailable',
			settlement: { kind: 'notStarted' }
		})
		expect(f.transactions.open).not.toHaveBeenCalled()
		assertCleared(f, snapshot)
	})
	it('does not invent an acquired handle when acquisition fails', async () => {
		const f = fixture()
		f.transactions.open.mockImplementation(() => {
			throw new Error(f.request.code)
		})
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'notStarted' } })
		expect(f.transactions.rollback).not.toHaveBeenCalled()
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	it.each(['unavailable', 'exception'])(
		'rolls back after an %s read instead of authorizing from absence',
		async (kind) => {
			const f = fixture()
			if (kind === 'unavailable') f.capability.read.mockReturnValue({ outcome: 'unavailable' })
			else
				f.capability.read.mockImplementation(() => {
					throw new Error(f.request.code)
				})
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'failed',
				settlement: { kind: 'notStarted' }
			})
			expect(f.capability.verifyCode).not.toHaveBeenCalled()
			expect(f.transactions.rollback).toHaveBeenCalledExactlyOnceWith(f.transaction)
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it.each(['missing', 'wrongId'])(
		'denies a %s invitation without issuing membership writes',
		async (kind) => {
			const f = fixture()
			f.observe({
				invitation: kind === 'missing' ? null : { ...f.invitation, id: 'another-invite' }
			})
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'completed',
				settlement: { kind: 'confirmed', decision: { outcome: 'invalid' } }
			})
			expect(f.capability.verifyCode).not.toHaveBeenCalled()
			expect(f.transactions.rollback).toHaveBeenCalledOnce()
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it.each(['workspaceId', 'accountId'] satisfies ('workspaceId' | 'accountId')[])(
		'fails closed on a membership with mismatched %s',
		async (field) => {
			const f = fixture()
			f.observe({ membership: { ...member, [field]: 'different' } })
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'failed',
				settlement: { kind: 'notStarted' }
			})
			expect(f.capability.verifyCode).not.toHaveBeenCalled()
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it.each([
		'operationId',
		'invitationId',
		'workspaceId',
		'accountId'
	] satisfies (keyof InvitationAuthorityEvidence)[])(
		'fails closed on evidence with mismatched %s',
		async (field) => {
			const f = fixture()
			f.observe({ evidence: evidence({ [field]: 'different' }) })
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'failed',
				settlement: { kind: 'notStarted' }
			})
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it('checks the code before returning membership or operation evidence', async () => {
		const f = fixture()
		f.observe({ membership: member, evidence: evidence() })
		f.capability.verifyCode.mockResolvedValue(false)
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			settlement: { kind: 'confirmed', decision: { outcome: 'invalid' } }
		})
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	it('contains verifier errors and rolls back before failing', async () => {
		const f = fixture()
		f.capability.verifyCode.mockRejectedValue(new Error(f.request.code))
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'notStarted' } })
		expect(f.transactions.rollback).toHaveBeenCalledOnce()
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	it('returns an accepted operation only while its exact membership still exists', async () => {
		const f = fixture()
		f.observe({
			membership: member,
			evidence: evidence(),
			invitation: {
				...f.invitation,
				revoked: true,
				expiresAt: 0,
				consumed: {
					accountId: 'verified-reader',
					operationId: 'operation',
					membershipId: member.id
				}
			}
		})
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			outcome: 'completed',
			settlement: { kind: 'confirmed', decision: { outcome: 'joined', membershipId: member.id } }
		})
		expect(f.capability.newMembershipId).not.toHaveBeenCalled()
		expect(f.transactions.rollback).toHaveBeenCalledOnce()
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	it.each(['removed', 'replaced'])(
		'does not restore access when the previous membership was %s',
		async (kind) => {
			const f = fixture()
			f.observe({
				evidence: evidence(),
				membership: kind === 'removed' ? null : { ...member, id: 'replacement' }
			})
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				settlement: { kind: 'confirmed', decision: { outcome: 'denied' } }
			})
			expect(f.capability.newMembershipId).not.toHaveBeenCalled()
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it('preserves an existing membership without regranting roles from an expired/revoked link', async () => {
		const f = fixture()
		f.observe({ membership: member, invitation: { ...f.invitation, revoked: true, expiresAt: 0 } })
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			settlement: {
				kind: 'confirmed',
				decision: { outcome: 'alreadyMember', membershipId: member.id }
			}
		})
		expect(f.capability.now).not.toHaveBeenCalled()
		expect(f.capability.newMembershipId).not.toHaveBeenCalled()
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	it.each(['revoked', 'expired', 'used'] satisfies ('revoked' | 'expired' | 'used')[])(
		'refuses a nonmember when the invitation is %s',
		async (outcome) => {
			const f = fixture()
			const patches = {
				revoked: { revoked: true },
				expired: { expiresAt: 1000 },
				used: {
					consumed: { accountId: 'other', operationId: 'earlier', membershipId: 'other-member' }
				}
			}
			f.observe({ invitation: { ...f.invitation, ...patches[outcome] } })
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				settlement: { kind: 'confirmed', decision: { outcome } }
			})
			expect(f.capability.newMembershipId).not.toHaveBeenCalled()
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it.each([
		{ expiresAt: 1000, outcome: 'expired' },
		{ expiresAt: 1001, outcome: 'joined' },
		{ expiresAt: null, outcome: 'joined' }
	])('uses the expiry boundary $expiresAt at the trusted clock', async ({ expiresAt, outcome }) => {
		const f = fixture()
		f.observe({ invitation: { ...f.invitation, expiresAt } })
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			settlement: { kind: 'confirmed', decision: { outcome } }
		})
		assertCleared(f, snapshot)
	})
	it('samples trusted time after verification rather than using the client or initial time', async () => {
		const f = fixture()
		f.capability.verifyCode.mockImplementation(async () => {
			f.capability.now.mockReturnValue(2000)
			return true
		})
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({
			settlement: { kind: 'confirmed', decision: { outcome: 'expired' } }
		})
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	it.each([NaN, Infinity, -Infinity])('fails closed on invalid service time %s', async (value) => {
		const f = fixture()
		f.capability.now.mockReturnValue(value)
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'notStarted' } })
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	it.each([NaN, Infinity, -Infinity])(
		'fails closed on invalid persisted expiry %s',
		async (expiresAt) => {
			const f = fixture()
			f.observe({ invitation: { ...f.invitation, expiresAt } })
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'failed',
				settlement: { kind: 'notStarted' }
			})
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it.each(['clock', 'prepare', 'stage'] satisfies ('clock' | 'prepare' | 'stage')[])(
		'rolls back a %s exception before acknowledging no write',
		async (leaf) => {
			const f = fixture(),
				failure = new Error(f.request.code)
			const failures = {
				clock: () =>
					f.capability.now.mockImplementation(() => {
						throw failure
					}),
				prepare: () => f.capability.newMembershipId.mockRejectedValue(failure),
				stage: () => f.capability.stage.mockRejectedValue(failure)
			}
			failures[leaf]()
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'failed',
				settlement: { kind: 'notStarted' }
			})
			expect(f.transactions.rollback).toHaveBeenCalledExactlyOnceWith(f.transaction)
			expect(f.transactions.commit).not.toHaveBeenCalled()
			assertCleared(f, snapshot)
		}
	)
	it('rejects an empty prepared membership ID before staging', async () => {
		const f = fixture()
		f.capability.newMembershipId.mockResolvedValue(' ')
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'notStarted' } })
		assertNoWrites(f)
		assertCleared(f, snapshot)
	})
	for (const interruption of interruptions) {
		it.each(phases)(
			`${interruption.type} drains %s and preserves the actual settlement`,
			async (phase) => {
				const f = fixture(),
					release = pause(f, phase)
				f.actor.start()
				await f.at(phase)
				f.actor.send({ type: interruption.type })
				f.actor.send({ type: interruption.type })
				expect(f.actor.getSnapshot().status).toBe('active')
				release()
				const snapshot = await f.done()
				expect(snapshot.output?.outcome).toBe(interruption.outcome)
				if (phase === 'committing' || phase === 'confirming') {
					expect(snapshot.output).toMatchObject({
						settlement: { kind: 'confirmed', decision: { outcome: 'joined' } }
					})
					expect(f.transactions.rollback).not.toHaveBeenCalled()
				} else if (phase === 'rollingBack') {
					expect(snapshot.output).toMatchObject({
						settlement: { kind: 'confirmed', decision: { outcome: 'invalid' } }
					})
				} else {
					expect(snapshot.output).toMatchObject({ settlement: { kind: 'notStarted' } })
					expect(f.transactions.commit).not.toHaveBeenCalled()
					if (phase !== 'admitting')
						expect(f.transactions.rollback).toHaveBeenCalledExactlyOnceWith(f.transaction)
				}
				assertCleared(f, snapshot)
			}
		)
	}
	it.each(interruptions)(
		'handles $type during a synchronous clock effect without staging',
		async ({ type, outcome }) => {
			const f = fixture()
			f.capability.now.mockImplementation(() => {
				f.actor.send({ type })
				return 1000
			})
			f.actor.start()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({ outcome, settlement: { kind: 'notStarted' } })
			expect(f.transactions.rollback).toHaveBeenCalledOnce()
			assertNoWrites(f)
			assertCleared(f, snapshot)
		}
	)
	it.each([
		['CANCEL', 'SHUTDOWN'],
		['SHUTDOWN', 'CANCEL']
	] satisfies InvitationAuthorityEvent['type'][][])(
		'shutdown wins across interruption order %j',
		async (...events) => {
			const f = fixture(),
				release = pause(f, 'staging')
			f.actor.start()
			await f.at('staging')
			for (const type of events) f.actor.send({ type })
			release()
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome: 'closed',
				settlement: { kind: 'notStarted' }
			})
			expect(f.transactions.commit).not.toHaveBeenCalled()
			assertCleared(f, snapshot)
		}
	)
	it.each(['commit', 'confirm'] satisfies ('commit' | 'confirm')[])(
		'hands uncertain %s resources to the host instead of retrying or rolling back',
		async (phase) => {
			const f = fixture()
			f.transactions[phase].mockImplementation(() => {
				throw new Error(f.request.code)
			})
			f.actor.start()
			const snapshot = await f.done()
			const result = snapshot.output
			expect(result).toMatchObject({ outcome: 'failed', settlement: { kind: 'unknown' } })
			if (result?.settlement.kind !== 'unknown') throw new Error('Expected retained resources')
			expect(result.settlement.retained.accountId).toBe('verified-reader')
			expect(result.settlement.retained.transaction).toBe(f.transaction)
			expect(result.settlement.retained.write).toBe(phase === 'confirm' ? f.write : undefined)
			expect(Object.keys(result.settlement.retained.access).sort()).toEqual(['confirm', 'rollback'])
			expect(f.transactions.commit).toHaveBeenCalledOnce()
			expect(f.transactions.rollback).not.toHaveBeenCalled()
			f.actor.send({ type: 'CANCEL' })
			expect(f.transactions.commit).toHaveBeenCalledOnce()
			assertCleared(f, snapshot)
		}
	)
	it.each(['false', 'exception'])(
		'transfers ownership after a %s rollback result',
		async (mode) => {
			const f = fixture()
			f.capability.stage.mockRejectedValue(new Error(f.request.code))
			if (mode === 'false') f.transactions.rollback.mockResolvedValue(false)
			else f.transactions.rollback.mockRejectedValue(new Error(f.credentials.bearer))
			f.actor.start()
			const snapshot = await f.done()
			const result = snapshot.output
			expect(result).toMatchObject({ outcome: 'failed', settlement: { kind: 'unknown' } })
			if (result?.settlement.kind !== 'unknown') throw new Error('Expected recovery handoff')
			expect(result.settlement.retained.transaction).toBe(f.transaction)
			expect(result.settlement.retained.write).toBeUndefined()
			f.transactions.rollback.mockImplementation(function (this: Transactions, transaction) {
				expect(this).toBe(f.transactions)
				expect(transaction).toBe(f.transaction)
				return true
			})
			expect(await result.settlement.retained.access.rollback(f.transaction)).toBe(true)
			expect(f.transactions.commit).not.toHaveBeenCalled()
			assertCleared(f, snapshot)
		}
	)
	it.each(interruptions)(
		'preserves unknown confirmation after $type',
		async ({ type, outcome }) => {
			const f = fixture(),
				confirmation = deferred<void>()
			f.transactions.confirm.mockReturnValue(confirmation.promise)
			f.actor.start()
			await f.at('confirming')
			f.actor.send({ type })
			confirmation.reject(new Error(f.request.code))
			const snapshot = await f.done()
			expect(snapshot.output).toMatchObject({
				outcome,
				settlement: { kind: 'unknown', retained: { accountId: 'verified-reader' } }
			})
			expect(f.transactions.rollback).not.toHaveBeenCalled()
			assertCleared(f, snapshot)
		}
	)
	it('contains an unexpected request-child crash and still rolls back the acquired handle', async () => {
		const f = fixture()
		const logic = createInvitationAuthorityMachine(f.capability).provide({
			actors: {
				verify: createAsyncLogic<
					{ outcome: 'succeeded'; value: boolean } | { outcome: 'failed' },
					{ code: string; digest: string }
				>({
					run: async () => {
						throw new Error(f.request.code)
					}
				})
			}
		})
		const actor = createActor(logic, { input: { credentials: f.credentials, request: f.request } })
		active.add(actor)
		actor.start()
		const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 1000 })
		expect(snapshot.output).toMatchObject({ outcome: 'failed', settlement: { kind: 'notStarted' } })
		expect(f.transactions.rollback).toHaveBeenCalledExactlyOnceWith(f.transaction)
		assertCleared(f, snapshot)
	})
})

describe('invitation detached native custody', () => {
	it('retains late acquisition after abrupt stop without issuing a read or rollback', async () => {
		const f = fixture(),
			opening = deferred<Transaction>()
		f.transactions.open.mockReturnValue(opening.promise)
		f.actor.start()
		await vi.waitFor(() => expect(f.transactions.open).toHaveBeenCalledOnce())
		f.actor.stop()
		const receipt = f.transactions.retainDetached.mock.calls[0]?.[0]
		if (!receipt) throw new Error('Missing custody')
		opening.resolve(f.transaction)
		expect(await receipt.acquisition).toBe(f.transaction)
		expect(f.capability.read).not.toHaveBeenCalled()
		expect(f.transactions.rollback).not.toHaveBeenCalled()
	})
	it('retains a pending stage before any host cleanup decision', async () => {
		const f = fixture(),
			stage = deferred<void>()
		f.capability.stage.mockReturnValue(stage.promise)
		f.actor.start()
		await vi.waitFor(() => expect(f.capability.stage).toHaveBeenCalledOnce())
		f.actor.stop()
		const receipt = f.transactions.retainDetached.mock.calls[0]?.[0]
		if (!receipt) throw new Error('Missing custody')
		stage.resolve()
		await receipt.pending
		expect(await receipt.acquisition).toBe(f.transaction)
		expect(receipt.commit).toBeUndefined()
		expect(f.transactions.commit).not.toHaveBeenCalled()
		expect(f.transactions.rollback).not.toHaveBeenCalled()
	})
	it('hands off an uncertain commit without issuing confirmation or rollback after stop', async () => {
		const f = fixture(),
			commit = deferred<{ write: Write }>()
		f.transactions.commit.mockReturnValue(commit.promise)
		f.actor.start()
		await vi.waitFor(() => expect(f.transactions.commit).toHaveBeenCalledOnce())
		f.actor.stop()
		const receipt = f.transactions.retainDetached.mock.calls[0]?.[0]
		if (!receipt?.commit) throw new Error('Missing commit custody')
		commit.resolve({ write: f.write })
		expect((await receipt.commit).write).toBe(f.write)
		expect(f.transactions.confirm).not.toHaveBeenCalled()
		expect(f.transactions.rollback).not.toHaveBeenCalled()
	})
	it('uses the existing unresolved output handoff without a second teardown owner', async () => {
		const f = fixture()
		f.transactions.confirm.mockRejectedValue(new Error('uncertain'))
		f.actor.start()
		const snapshot = await f.done()
		expect(snapshot.output?.settlement.kind).toBe('unknown')
		expect(f.transactions.retainDetached).not.toHaveBeenCalled()
	})
	it('does not detach confirmed success or graceful cancellation', async () => {
		const f = fixture()
		f.actor.start()
		await f.done()
		expect(f.transactions.retainDetached).not.toHaveBeenCalled()
		const cancelled = fixture(),
			opening = deferred<Transaction>()
		cancelled.transactions.open.mockReturnValue(opening.promise)
		cancelled.actor.start()
		await vi.waitFor(() => expect(cancelled.transactions.open).toHaveBeenCalledOnce())
		cancelled.actor.send({ type: 'CANCEL' })
		opening.resolve(cancelled.transaction)
		await cancelled.done()
		expect(cancelled.transactions.rollback).toHaveBeenCalledOnce()
		expect(cancelled.transactions.retainDetached).not.toHaveBeenCalled()
	})
})

it('retains invitation custody when the owner crashes after acquisition', async () => {
	const f = fixture(),
		errors: unknown[] = []
	const logic = createInvitationAuthorityMachine(f.capability).provide({
		guards: {
			closing: ({ context }) => {
				if (context.resources.transaction !== undefined) throw new Error('owner failed')
				return false
			}
		}
	})
	const actor = createActor(logic, { input: { credentials: f.credentials, request: f.request } })
	active.add(actor)
	actor.subscribe({ error: (error) => errors.push(error) })
	actor.start()
	await vi.waitFor(() => expect(errors).toHaveLength(1))
	const receipt = f.transactions.retainDetached.mock.calls[0]?.[0]
	if (!receipt) throw new Error('Missing custody')
	expect(await receipt.acquisition).toBe(f.transaction)
	expect(f.transactions.rollback).not.toHaveBeenCalled()
})
