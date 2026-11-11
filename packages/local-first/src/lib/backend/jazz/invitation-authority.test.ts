import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { schema as s, type Db, type Transaction } from 'jazz-tools'
import { RequestAuthenticationError, NoJazzAccountError, type Jazz } from 'jazz-tools/backend'
import { createPolicyTestApp, type PolicyTestApp } from 'jazz-tools/testing'
import { createActor } from 'xstate'
import { deferred } from '../../../../tests/helpers/deferred.js'
import { createInvitationAuthorityMachine } from '../../machines/workspaces/invitation-authority.js'
import type { SerializableWriteHandle } from 'jazz-tools'
import { createJazzInvitationAuthority } from './invitation-authority.js'

// This is a native delegation fixture, not the future invitation schema or its access policy.
const app = s.defineApp({ notes: s.table({ text: s.string() }, {}) }, { migrations: 'none' })
const permissions = s.definePermissions(app, ({ policy }) => {
	policy.notes.allowRead.always()
	policy.notes.allowInsert.always()
	policy.notes.allowUpdate.always()
	policy.notes.allowDelete.always()
})
const session = {
	user_id: 'invitation-adapter-user',
	authMode: 'local-first',
	claims: {}
} satisfies import('jazz-tools/testing').PolicyTestSession
let fixture: PolicyTestApp
let db: Db
let accountId: string
const noteId = crypto.randomUUID()
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
	db = fixture.as(session)
	accountId = fixture.accountFor(session)
	await fixture.seed((seed) => seed.insert(app.notes, { text: 'before' }, { id: noteId }))
}, 30000)
afterAll(async () => {
	await fixture?.shutdown()
})
afterEach(() => vi.restoreAllMocks())
function adapter() {
	const verify = vi.fn<Jazz['forReqUser']>().mockResolvedValue(db)
	const retain =
		vi.fn<
			(
				accountId: string,
				custody: import('../../contracts/transaction-custody.js').DetachedTransaction<
					Transaction<'serializable'>,
					Readonly<{ write: SerializableWriteHandle }>
				>
			) => void
		>()
	return {
		verify,
		retain,
		authority: createJazzInvitationAuthority({ forReqUser: verify }, retain)
	}
}
function request() {
	return new Request('https://example.test/redeem', {
		method: 'POST',
		headers: { authorization: 'Bearer synthetic-original', cookie: 'synthetic-session=original' },
		body: JSON.stringify({ accountId: 'forged-body-account', code: 'synthetic-private-code' })
	})
}
async function admitted() {
	const f = adapter()
	const result = await f.authority.admit(request())
	if (result.outcome !== 'admitted') throw new Error('Expected admitted fixture')
	return { ...f, result }
}

describe('Jazz invitation authority boundary', () => {
	it('is lazy and delegates one request admission without trusting body identity', async () => {
		const f = adapter()
		expect(f.verify).not.toHaveBeenCalled()
		const incoming = request()
		const result = await f.authority.admit(incoming)
		expect(result.outcome).toBe('admitted')
		if (result.outcome !== 'admitted') throw new Error('Expected admission')
		expect(result.accountId).toBe(accountId)
		expect(f.verify).toHaveBeenCalledOnce()
		const captured = f.verify.mock.calls[0]?.[0]
		expect(captured).toBeInstanceOf(Request)
		expect(captured?.url).toBe('https://example.test/redeem')
		expect(captured?.method).toBe('POST')
		expect(captured?.headers.get('authorization')).toBe('Bearer synthetic-original')
		expect(captured?.headers.get('cookie')).toBe('synthetic-session=original')
		expect(captured?.body).toBeNull()
		expect(incoming.bodyUsed).toBe(false)
		expect(Object.keys(result).sort()).toEqual(['accountId', 'outcome', 'transactions'])
		expect(JSON.stringify(result)).not.toContain('synthetic-')
	})
	it('captures immutable credentials before a later host header mutation', async () => {
		const f = adapter()
		const pending = new Promise<Db>((resolve) => {
			queueMicrotask(() => resolve(db))
		})
		f.verify.mockReturnValue(pending)
		const incoming = request()
		const result = f.authority.admit(incoming)
		incoming.headers.set('authorization', 'Bearer synthetic-replaced')
		incoming.headers.set('cookie', 'synthetic-session=replaced')
		await result
		expect(f.verify).toHaveBeenCalledOnce()
		const captured = f.verify.mock.calls[0]?.[0]
		expect(captured).toBeInstanceOf(Request)
		expect(captured?.url).toBe('https://example.test/redeem')
		expect(captured?.method).toBe('POST')
		expect(captured?.headers.get('authorization')).toBe('Bearer synthetic-original')
		expect(captured?.headers.get('cookie')).toBe('synthetic-session=original')
		expect(captured?.body).toBeNull()
	})
	it('keeps interleaved request credentials separate', async () => {
		const f = adapter()
		const first = request(),
			second = request()
		second.headers.set('authorization', 'Bearer second-caller')
		await Promise.all([f.authority.admit(first), f.authority.admit(second)])
		expect(f.verify.mock.calls[0]?.[0].headers.get('authorization')).toBe(
			'Bearer synthetic-original'
		)
		expect(f.verify.mock.calls[1]?.[0].headers.get('authorization')).toBe('Bearer second-caller')
	})
	it.each(['missing', 'malformed', 'expired', 'rejected'])(
		'returns unauthenticated for an SDK %s credential rejection',
		async (reason) => {
			const f = adapter()
			f.verify.mockRejectedValue(new RequestAuthenticationError(`synthetic-${reason}-credential`))
			const incoming = request()
			if (reason === 'missing') incoming.headers.delete('authorization')
			expect(await f.authority.admit(incoming)).toEqual({ outcome: 'unauthenticated' })
			expect(f.verify).toHaveBeenCalledOnce()
			if (reason === 'missing')
				expect(f.verify.mock.calls[0]?.[0].headers.get('authorization')).toBeNull()
		}
	)
	it('recognizes the documented cross-copy authentication error', async () => {
		const f = adapter()
		const error = new Error('synthetic-sensitive-error')
		error.name = 'RequestAuthenticationError'
		f.verify.mockRejectedValue(error)
		expect(await f.authority.admit(request())).toEqual({ outcome: 'unauthenticated' })
	})
	it.each(['native', 'cross-copy'])(
		'returns unauthenticated for a %s no-account verdict',
		async (kind) => {
			const f = adapter()
			const error =
				kind === 'native'
					? new NoJazzAccountError('synthetic-user', 'fixture')
					: Object.assign(new Error('synthetic-private-user'), {
							name: 'NoJazzAccountError',
							code: 'no_account'
						})
			f.verify.mockRejectedValue(error)
			expect(await f.authority.admit(request())).toEqual({ outcome: 'unauthenticated' })
			expect(f.verify).toHaveBeenCalledOnce()
		}
	)
	it('keeps authority outage distinct from invalid authentication and drops raw error text', async () => {
		const f = adapter()
		f.verify.mockRejectedValue(new Error('Bearer synthetic-private-credential'))
		expect(await f.authority.admit(request())).toEqual({ outcome: 'unavailable' })
		expect(f.verify).toHaveBeenCalledOnce()
	})
	it('fails closed if the admitted database has no verified session', async () => {
		const f = adapter()
		vi.spyOn(db, 'getAuthState').mockReturnValue({ authMode: 'external', session: null })
		expect(await f.authority.admit(request())).toEqual({ outcome: 'unauthenticated' })
	})
	it('contains header-capture errors without invoking admission', async () => {
		const f = adapter()
		const incoming = request()
		vi.spyOn(incoming, 'headers', 'get').mockImplementation(() => {
			throw new Error('synthetic-sensitive-header')
		})
		expect(await f.authority.admit(incoming)).toEqual({ outcome: 'unavailable' })
		expect(f.verify).not.toHaveBeenCalled()
	})
	it('does not open a transaction on admission or close the host database', async () => {
		const open = vi.spyOn(db, 'beginSerializableTransaction'),
			close = vi.spyOn(db, 'shutdown')
		await admitted()
		expect(open).not.toHaveBeenCalled()
		expect(close).not.toHaveBeenCalled()
	})
	it('preserves the native serializable receipt and confirms only through tierless authority wait', async () => {
		const { result } = await admitted()
		const access = result.transactions
		const tx = await access.open()
		expect(tx.kind).toBe('serializable')
		const row = await tx.one(app.notes.where({ id: noteId }))
		expect(row?.text).toBe('before')
		tx.update(app.notes, noteId, { text: 'confirmed' })
		const issue = vi.spyOn(tx, 'commit')
		const envelope = await access.commit(tx)
		expect(issue).toHaveBeenCalledOnce()
		expect(envelope.write).toBe(issue.mock.results[0]?.value)
		const wait = vi.spyOn(envelope.write, 'wait')
		await access.confirm(envelope.write)
		expect(wait).toHaveBeenCalledExactlyOnceWith()
		expect((await db.one(app.notes.where({ id: noteId }), { tier: 'remote' }))?.text).toBe(
			'confirmed'
		)
	})
	it('rolls back staged native writes rather than committing them', async () => {
		const { result } = await admitted()
		const access = result.transactions
		const tx = await access.open()
		const id = crypto.randomUUID()
		tx.insert(app.notes, { text: 'must-not-persist' }, { id })
		const rollback = vi.spyOn(tx, 'rollback'),
			commit = vi.spyOn(tx, 'commit')
		expect(await access.rollback(tx)).toBe(true)
		expect(rollback).toHaveBeenCalledExactlyOnceWith()
		expect(commit).not.toHaveBeenCalled()
		expect(await db.one(app.notes.where({ id }), { tier: 'remote' })).toBeNull()
	})
	it('preserves false rollback and its errors for the future resource owner', async () => {
		const { result } = await admitted()
		const tx = await result.transactions.open()
		const rollback = vi.spyOn(tx, 'rollback').mockResolvedValueOnce(false)
		expect(await result.transactions.rollback(tx)).toBe(false)
		const error = new Error('synthetic rollback failure')
		rollback.mockRejectedValueOnce(error)
		await expect(result.transactions.rollback(tx)).rejects.toBe(error)
		rollback.mockRestore()
		await tx.rollback()
	})
	it('preserves acquisition failure without inventing an acquired handle', async () => {
		const { result } = await admitted()
		const failure = new Error('synthetic acquisition failure')
		vi.spyOn(db, 'beginSerializableTransaction').mockImplementation(() => {
			throw failure
		})
		expect(() => result.transactions.open()).toThrow(failure)
	})
	it('preserves commit issue errors for rollback/uncertainty classification by the owner', async () => {
		const { result } = await admitted()
		const tx = await result.transactions.open()
		const failure = new Error('synthetic issue failure')
		const commit = vi.spyOn(tx, 'commit').mockImplementation(() => {
			throw failure
		})
		expect(() => result.transactions.commit(tx)).toThrow(failure)
		commit.mockRestore()
		await tx.rollback()
	})
	it('preserves authority confirmation rejection and never substitutes local persistence', async () => {
		const { result } = await admitted()
		const tx: Transaction<'serializable'> = await result.transactions.open()
		const envelope = await result.transactions.commit(tx)
		// Drain the real empty transaction before injecting a rejected confirmation for this boundary.
		await envelope.write.wait()
		const failure = new Error('synthetic confirmation failure')
		const wait = vi.spyOn(envelope.write, 'wait').mockRejectedValue(failure)
		await expect(result.transactions.confirm(envelope.write)).rejects.toBe(failure)
		expect(wait).toHaveBeenCalledExactlyOnceWith()
	})
})

describe('native transaction custody handoff', () => {
	it('retains an actual Jazz serializable transaction after owner stop for host rollback', async () => {
		const f = adapter(),
			read = deferred<void>()
		const actor = createActor(
			createInvitationAuthorityMachine({
				admit: () => f.authority.admit(request()),
				read: async () => {
					await read.promise
					return { outcome: 'unavailable' }
				},
				verifyCode: () => true,
				now: () => 1000,
				newMembershipId: () => 'member',
				stage: () => {}
			}),
			{
				input: {
					credentials: {},
					request: { operationId: 'op', invitationId: 'invite', code: 'code' }
				}
			}
		)
		try {
			actor.start()
			await vi.waitFor(() =>
				expect(actor.getSnapshot().value).toEqual({
					running: { control: 'active', work: 'reading' }
				})
			)
			actor.stop()
			const handoff = f.retain.mock.calls[0]
			if (!handoff) throw new Error('Missing native custody')
			expect(handoff[0]).toBe(accountId)
			const native = await handoff[1].acquisition
			expect(native.kind).toBe('serializable')
			read.resolve()
			await handoff[1].pending
			expect(handoff[1].commit).toBeUndefined()
			expect(await native.rollback()).toBe(true)
		} finally {
			read.resolve()
			actor.stop()
		}
	})
})
