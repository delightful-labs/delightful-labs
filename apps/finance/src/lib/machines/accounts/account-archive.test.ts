import { describe, expect, it, vi } from 'vitest'
import { required } from '../bank-sync/identity.js'
import { createAccountArchiveMachine, selectAccountArchiveView } from './account-archive.js'
import {
	createAccountArchiveOperation,
	type ArchiveObservation,
	type ArchiveRequest
} from './account-archive-operation.js'
import { createActor, toPromise, waitFor } from 'xstate'

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`
function fixture() {
	const observation: ArchiveObservation = {
		identityId: id(1),
		organizationId: id(2),
		binding: {},
		sessionReady: true,
		loading: false,
		failed: false,
		accounts: [
			{
				id: id(3),
				organizationId: id(2),
				name: 'Checking',
				kind: 'bank',
				currency: 'USD',
				archivedAt: null
			}
		],
		membership: {
			id: id(4),
			organizationId: id(2),
			userId: id(1),
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		},
		grants: []
	}
	const request: ArchiveRequest = {
		identityId: id(1),
		organizationId: id(2),
		binding: required(observation.binding),
		accountId: id(3),
		name: 'Checking'
	}
	return { observation, request }
}
function deferred() {
	let resolve!: () => void
	let reject!: (reason: Error) => void
	const promise = new Promise<void>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}

describe('account archive ownership and view', () => {
	it('distinguishes blocked readiness and rejects direct submissions', () => {
		const { observation } = fixture()
		const persist = vi.fn(async () => {})
		const actor = createActor(createAccountArchiveMachine(persist, () => observation)).start()
		try {
			const cases: { change: Partial<ArchiveObservation>; kind: string }[] = [
				{ change: { sessionReady: false }, kind: 'sessionUnavailable' },
				{ change: { organizationId: null }, kind: 'selectWorkspace' },
				{ change: { loading: true }, kind: 'loading' },
				{ change: { loading: true, failed: true }, kind: 'loadFailed' }
			]
			for (const { change, kind } of cases) {
				actor.send({ type: 'OBSERVE', observation: { ...observation, ...change } })
				expect(selectAccountArchiveView(actor.getSnapshot()).kind).toBe(kind)
				actor.send({ type: 'ARCHIVE', accountId: id(3) })
			}
			expect(persist).not.toHaveBeenCalled()
		} finally {
			actor.stop()
		}
	})
	it('keeps row capabilities and event acceptance aligned for scoped grants', async () => {
		const { observation } = fixture()
		const persist = vi.fn(async () => {})
		const actor = createActor(createAccountArchiveMachine(persist, () => observation)).start()
		try {
			const changes: Partial<ArchiveObservation>[] = [
				{ membership: { ...required(observation.membership), role: 'viewer' } },
				{ membership: { ...required(observation.membership), userId: id(9) } },
				{
					membership: {
						...required(observation.membership),
						role: 'member',
						accountAccessMode: 'selected'
					},
					grants: [{ organizationId: id(2), userId: id(9), accountId: id(3), access: 'write' }]
				}
			]
			for (const change of changes) {
				actor.send({ type: 'OBSERVE', observation: { ...observation, ...change } })
				expect(selectAccountArchiveView(actor.getSnapshot()).rows[0]?.action).toBe('unavailable')
				actor.send({ type: 'ARCHIVE', accountId: id(3) })
			}
			expect(persist).not.toHaveBeenCalled()
			actor.send({ type: 'OBSERVE', observation })
			expect(selectAccountArchiveView(actor.getSnapshot()).rows[0]?.action).toBe('available')
			actor.send({ type: 'ARCHIVE', accountId: id(3) })
			await waitFor(actor, (s) => s.context.result?.outcome === 'succeeded')
			expect(persist).toHaveBeenCalledTimes(1)
		} finally {
			actor.stop()
		}
	})
	it('rejects duplicate requests and hides results from replacement workspaces', async () => {
		const { observation } = fixture()
		let current = observation
		const write = deferred()
		const persist = vi.fn(() => write.promise)
		const actor = createActor(createAccountArchiveMachine(persist, () => current)).start()
		try {
			actor.send({ type: 'ARCHIVE', accountId: id(3) })
			expect(selectAccountArchiveView(actor.getSnapshot()).rows[0]?.action).toBe('archiving')
			actor.send({ type: 'ARCHIVE', accountId: id(3) })
			current = { ...observation, organizationId: id(9), loading: true }
			actor.send({ type: 'OBSERVE', observation: current })
			expect(selectAccountArchiveView(actor.getSnapshot()).kind).toBe('loading')
			write.resolve()
			await waitFor(actor, (s) => s.context.result !== undefined)
			expect(actor.getSnapshot().context.result).toMatchObject({
				outcome: 'scopeChanged',
				settlement: 'locallyPersisted'
			})
			expect(selectAccountArchiveView(actor.getSnapshot()).feedback).toBeUndefined()
			expect(persist).toHaveBeenCalledTimes(1)
		} finally {
			actor.stop()
		}
	})
	it('waits for issued writes on shutdown and never returns to ready', async () => {
		const { observation } = fixture()
		const write = deferred()
		const actor = createActor(
			createAccountArchiveMachine(
				() => write.promise,
				() => observation
			)
		).start()
		actor.send({ type: 'ARCHIVE', accountId: id(3) })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'OBSERVE', observation })
		expect(actor.getSnapshot().matches({ operating: 'closing' })).toBe(true)
		expect(actor.getSnapshot().status).toBe('active')
		write.resolve()
		await toPromise(actor)
		expect(actor.getSnapshot().matches('closed')).toBe(true)
	})
})

describe('account archive operation', () => {
	it.each<'invalid' | 'denied' | 'unavailable' | 'scopeChanged'>([
		'invalid',
		'denied',
		'unavailable',
		'scopeChanged'
	])('returns %s before writing', async (outcome) => {
		const { observation, request } = fixture()
		const persist = vi.fn(async () => {})
		const current =
			outcome === 'denied'
				? { ...observation, membership: null }
				: outcome === 'unavailable'
					? { ...observation, loading: true }
					: outcome === 'scopeChanged'
						? { ...observation, binding: {} }
						: observation
		const actor = createActor(
			createAccountArchiveOperation(persist, () => current),
			{
				input: {
					observation,
					request: outcome === 'invalid' ? { ...request, accountId: 'bad-id' } : request
				}
			}
		).start()
		expect(await toPromise(actor)).toMatchObject({ outcome, settlement: 'notStarted' })
		expect(persist).not.toHaveBeenCalled()
	})
	it.each<'resolved' | 'rejected'>(['resolved', 'rejected'])(
		'records actual %s settlement after cancellation',
		async (settlement) => {
			const { observation, request } = fixture()
			const write = deferred()
			const actor = createActor(
				createAccountArchiveOperation(
					() => write.promise,
					() => observation
				),
				{ input: { observation, request } }
			).start()
			actor.send({ type: 'CANCEL' })
			expect(actor.getSnapshot().matches({ writing: 'settlingCancellation' })).toBe(true)
			expect(actor.getSnapshot().status).toBe('active')
			if (settlement === 'resolved') write.resolve()
			else write.reject(new Error('Write rejected'))
			expect(await toPromise(actor)).toMatchObject({
				outcome: 'cancelled',
				settlement: settlement === 'resolved' ? 'locallyPersisted' : 'rejected'
			})
		}
	)
	it('gives shutdown priority over scope changes and cancellation', async () => {
		const { observation, request } = fixture()
		const write = deferred()
		const persist = vi.fn(() => write.promise)
		const actor = createActor(
			createAccountArchiveOperation(persist, () => observation),
			{ input: { observation, request } }
		).start()
		actor.send({ type: 'OBSERVE', observation: { ...observation, membership: null } })
		expect(actor.getSnapshot().matches({ writing: 'settlingScopeChange' })).toBe(true)
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'OBSERVE', observation })
		write.resolve()
		expect(await toPromise(actor)).toMatchObject({
			outcome: 'closed',
			settlement: 'locallyPersisted'
		})
		expect(persist).toHaveBeenCalledTimes(1)
	})
	it('does not misclassify its optimistic account removal as cancellation', async () => {
		const { observation, request } = fixture()
		const write = deferred()
		const actor = createActor(
			createAccountArchiveOperation(
				() => write.promise,
				() => observation
			),
			{ input: { observation, request } }
		).start()
		actor.send({ type: 'OBSERVE', observation: { ...observation, accounts: [] } })
		write.resolve()
		expect(await toPromise(actor)).toMatchObject({
			outcome: 'succeeded',
			settlement: 'locallyPersisted'
		})
	})
	it('reports persistence failure independently of cancellation', async () => {
		const { observation, request } = fixture()
		const actor = createActor(
			createAccountArchiveOperation(
				async () => {
					throw new Error('Rejected')
				},
				() => observation
			),
			{ input: { observation, request } }
		).start()
		expect(await toPromise(actor)).toMatchObject({ outcome: 'failed', settlement: 'rejected' })
	})
})
