import { describe, expect, it } from 'vitest'
import { assess, brokenRecords, membership, records, scope } from './workspace-integrity.fixture.js'

describe('workspace integrity assessment', () => {
	it('accepts consistent profile and membership records without category data', () => {
		expect(assess().output).toEqual({ outcome: 'complete' })
	})
	for (const role of ['owner', 'admin'] satisfies (typeof membership.role)[]) {
		it(`allows ${role} to repair the existing profile link`, () => {
			const result = assess({ records: brokenRecordsWithRole(role) })
			expect(result.value).toBe('repair')
			expect(result.output).toEqual({
				outcome: 'repair',
				plan: {
					profileLink: { membershipId: membership.id, profileId: scope.profileId }
				}
			})
		})
	}
	it('retains a profile-link issue for members without repair authority', () => {
		expect(assess({ records: brokenRecordsWithRole('member') }).output).toEqual({
			outcome: 'partial',
			issues: ['profileLink']
		})
	})
	it('does not grant viewer repair authority from workspace creator identity', () => {
		const snapshot = brokenRecordsWithRole('viewer')
		snapshot.organizations = snapshot.organizations.map((row) => ({
			...row,
			ownerId: scope.userId
		}))
		const result = assess({ records: snapshot })
		expect(result.value).toBe('partial')
		expect(result.output).toEqual({
			outcome: 'partial',
			issues: ['profileLink']
		})
	})
	for (const [name, snapshot] of [
		['missing membership', records({ memberships: [] })],
		['missing workspace', records({ organizations: [] })],
		['missing profile', records({ profiles: [] })]
	] satisfies [string, ReturnType<typeof records>][]) {
		it(`reports ${name} without planning replacement records`, () => {
			expect(assess({ records: snapshot }).value).toBe('unavailable')
		})
	}
	it('rejects duplicate or mismatched login profiles and memberships', () => {
		const snapshot = records()
		expect(
			assess({ records: records({ profiles: [...snapshot.profiles, ...snapshot.profiles] }) })
				.output
		).toEqual({ outcome: 'conflict', reason: 'profileAmbiguous' })
		expect(assess({ profileId: membership.id }).value).toBe('conflict')
		expect(assess({ records: records({ memberships: [membership, membership] }) }).output).toEqual({
			outcome: 'conflict',
			reason: 'membershipAmbiguous'
		})
		expect(
			assess({ records: records({ memberships: [{ ...membership, userId: membership.id }] }) })
				.value
		).toBe('conflict')
	})
})

function brokenRecordsWithRole(role: typeof membership.role) {
	return { ...brokenRecords(), memberships: [{ ...membership, profileId: null, role }] }
}
