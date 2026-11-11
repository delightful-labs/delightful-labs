import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createProfilePersistenceMachine } from './profile-persistence.js'
import { profileScope, type ProfileObservation } from '../../contracts/profile.js'
import { deferred } from '../../../../tests/helpers/deferred.js'

const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(facts?: Partial<ProfileObservation>) {
	const observation: ProfileObservation = {
		identityId: 'member',
		binding: {},
		sessionReady: true,
		loading: false,
		failed: false,
		profile: { id: 'profile', userId: 'member' },
		...facts
	}
	const receipt = deferred<void>()
	const save = vi.fn(
		(_profile: string, _identity: string, _values: { name: string }) => receipt.promise
	)
	const actor = createActor(createProfilePersistenceMachine({ save, settlement: 'confirmed' }), {
		input: {
			request: {
				id: 1,
				scope: profileScope(observation),
				scopeRevision: 1,
				values: { name: 'private-name' }
			},
			observation: { revision: 1, facts: observation }
		}
	})
	actors.add(actor)
	return { actor, save, receipt, observation }
}
describe('profile persistence admission and settlement', () => {
	it('does not issue a save without an identity', async () => {
		const f = fixture({ identityId: null })
		f.actor.start()
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'unavailable',
			reason: 'sessionUnavailable',
			settlement: 'notStarted'
		})
		expect(f.save).not.toHaveBeenCalled()
	})
	it('does not issue a save without a profile', async () => {
		const f = fixture({ profile: null })
		f.actor.start()
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'unavailable',
			reason: 'profileUnavailable',
			settlement: 'notStarted'
		})
		expect(f.save).not.toHaveBeenCalled()
	})
	it.each(['CANCEL', 'SHUTDOWN', 'INVALIDATE'])(
		'drains an issued save after %s and preserves its receipt',
		async (type) => {
			const f = fixture()
			f.actor.start()
			await vi.waitFor(() => expect(f.save).toHaveBeenCalledOnce())
			const event =
				type === 'CANCEL'
					? ({ type: 'CANCEL' } satisfies { type: 'CANCEL' })
					: type === 'SHUTDOWN'
						? ({ type: 'SHUTDOWN' } satisfies { type: 'SHUTDOWN' })
						: ({ type: 'INVALIDATE' } satisfies { type: 'INVALIDATE' })
			f.actor.send(event)
			expect(f.actor.getSnapshot().status).toBe('active')
			f.receipt.resolve()
			expect(await toPromise(f.actor)).toEqual({
				outcome: type === 'CANCEL' ? 'cancelled' : type === 'SHUTDOWN' ? 'closed' : 'scopeChanged',
				settlement: 'confirmed'
			})
			expect(f.actor.getSnapshot().context.request).toBeUndefined()
			expect(JSON.stringify(f.actor.getSnapshot().context)).not.toContain('private-name')
		}
	)
	it('does not restore eligibility after A -> B -> A during a save', async () => {
		const f = fixture()
		f.actor.start()
		await vi.waitFor(() => expect(f.save).toHaveBeenCalledOnce())
		f.actor.send({
			type: 'OBSERVE',
			observation: { revision: 2, facts: { ...f.observation, identityId: 'other' } }
		})
		f.actor.send({ type: 'OBSERVE', observation: { revision: 3, facts: f.observation } })
		f.receipt.resolve()
		expect(await toPromise(f.actor)).toEqual({ outcome: 'scopeChanged', settlement: 'confirmed' })
		expect(f.save).toHaveBeenCalledOnce()
	})
	it('retains unknown settlement after a rejected save without replay', async () => {
		const f = fixture()
		f.actor.start()
		await vi.waitFor(() => expect(f.save).toHaveBeenCalledOnce())
		f.receipt.reject(new Error('private SDK error'))
		expect(await toPromise(f.actor)).toEqual({
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'unknown'
		})
		expect(f.save).toHaveBeenCalledOnce()
		expect(JSON.stringify(f.actor.getSnapshot())).not.toContain('private SDK error')
	})
})
