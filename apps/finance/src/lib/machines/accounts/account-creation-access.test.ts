import { describe, expect, it } from 'vitest'
import type { OrganizationMember } from '#lib/schema.js'
import { accountCreationAccessMachine } from './account-creation-access.js'
import { createActor } from 'xstate'

const membership = {
	id: 'membership',
	organizationId: 'workspace',
	userId: 'user',
	role: 'owner',
	accountAccessMode: 'all',
	profileId: null
} satisfies OrganizationMember
const source = {
	organizationId: 'workspace',
	userId: 'user',
	sessionReady: true,
	membership,
	loading: false,
	error: null
}

describe('account creation access', () => {
	it('waits for a session, workspace and membership readiness', () => {
		const actor = createActor(accountCreationAccessMachine).start()
		try {
			expect(actor.getSnapshot().matches('waiting')).toBe(true)
			for (const change of [
				{ sessionReady: false },
				{ organizationId: null },
				{ userId: undefined },
				{ loading: true }
			]) {
				actor.send({ type: 'OBSERVE', source: { ...source, ...change } })
				expect(actor.getSnapshot().matches('waiting')).toBe(true)
				expect(actor.getSnapshot().hasTag('can-create')).toBe(false)
			}
		} finally {
			actor.stop()
		}
	})

	it.each<OrganizationMember['role']>(['owner', 'admin', 'member', 'viewer'])(
		'only enables owner/admin creation for %s',
		(role) => {
			const actor = createActor(accountCreationAccessMachine).start()
			try {
				actor.send({ type: 'OBSERVE', source: { ...source, membership: { ...membership, role } } })
				expect(actor.getSnapshot().hasTag('can-create')).toBe(role === 'owner' || role === 'admin')
			} finally {
				actor.stop()
			}
		}
	)

	it('rejects missing, stale-workspace and stale-user memberships', () => {
		const actor = createActor(accountCreationAccessMachine).start()
		try {
			for (const row of [
				null,
				undefined,
				{ ...membership, organizationId: 'other-workspace' },
				{ ...membership, userId: 'other-user' }
			]) {
				actor.send({ type: 'OBSERVE', source: { ...source, membership: row } })
				expect(actor.getSnapshot().matches('denied')).toBe(true)
				expect(actor.getSnapshot().hasTag('can-create')).toBe(false)
			}
		} finally {
			actor.stop()
		}
	})

	it('revokes permission on errors/scope changes and recovers after a fresh observation', () => {
		const actor = createActor(accountCreationAccessMachine).start()
		try {
			actor.send({ type: 'OBSERVE', source })
			expect(actor.getSnapshot().hasTag('can-create')).toBe(true)
			actor.send({ type: 'OBSERVE', source: { ...source, error: new Error('Unavailable') } })
			expect(actor.getSnapshot().matches('error')).toBe(true)
			expect(actor.getSnapshot().hasTag('can-create')).toBe(false)
			actor.send({ type: 'OBSERVE', source: { ...source, organizationId: 'other-workspace' } })
			expect(actor.getSnapshot().matches('denied')).toBe(true)
			actor.send({ type: 'OBSERVE', source })
			expect(actor.getSnapshot().hasTag('can-create')).toBe(true)
			actor.send({
				type: 'OBSERVE',
				source: { ...source, membership: { ...membership, role: 'viewer' } }
			})
			expect(actor.getSnapshot().matches('denied')).toBe(true)
		} finally {
			actor.stop()
		}
	})
})
