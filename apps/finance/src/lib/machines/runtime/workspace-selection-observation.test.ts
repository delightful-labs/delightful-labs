import { describe, expect, it } from 'vitest'
import {
	workspaceSelectionTarget,
	workspaceSelectionObservation
} from './workspace-selection-observation.js'
import type { ReadinessObservation } from './readiness.js'

const workspaceId = '33333333-3333-4333-8333-333333333333'
const scope = { binding: {}, attachment: {} }
const request = { workspaceId, attempt: 1 }
function facts(): ReadinessObservation {
	return {
		source: {
			organizationId: workspaceId,
			userId: 'user',
			membership: {
				id: 'membership',
				userId: 'user',
				organizationId: workspaceId,
				role: 'owner',
				accountAccessMode: 'all',
				profileId: null
			}
		},
		sessionStatus: 'ready',
		membershipLoading: false,
		membershipError: undefined,
		organizations: [],
		organizationsLoading: false,
		organizationsError: undefined,
		route: { pathname: '/expenses', search: `?workspace=${workspaceId}`, hash: '' }
	}
}
describe('workspace selection local facts adapter', () => {
	it.each([
		{
			name: 'empty',
			organizations: [],
			organizationsLoading: false,
			organizationsError: undefined
		},
		{
			name: 'loading',
			organizations: undefined,
			organizationsLoading: true,
			organizationsError: undefined
		},
		{
			name: 'missing',
			organizations: undefined,
			organizationsLoading: false,
			organizationsError: undefined
		},
		{
			name: 'failed',
			organizations: undefined,
			organizationsLoading: false,
			organizationsError: new Error('Directory unavailable')
		}
	])('allows exact local membership with a $name directory', (change) => {
		const observation = workspaceSelectionObservation({ ...facts(), ...change }, scope, request, 7)
		expect(observation.access).toBe('allowed')
		expect(observation.scope).toBe(scope)
		expect(observation.request).toBe(request)
		expect(observation.generation).toBe(7)
	})
	it.each([
		{ label: 'loading membership', update: { membershipLoading: true }, expected: 'unknown' },
		{
			label: 'failed membership',
			update: { membershipError: new Error('Failed') },
			expected: 'failed'
		},
		{ label: 'signed out', update: { sessionStatus: 'signed-out' }, expected: 'unavailable' },
		{
			label: 'session transition',
			update: { sessionStatus: 'transitioning' },
			expected: 'unavailable'
		}
	] satisfies { label: string; update: Partial<ReadinessObservation>; expected: string }[])(
		'maps $label without treating directory rows as permission',
		({ update, expected }) => {
			expect(
				workspaceSelectionObservation({ ...facts(), ...update }, scope, request, 0).access
			).toBe(expected)
		}
	)
	it('keeps missing membership unknown and mismatched local membership denied', () => {
		const original = facts()
		expect(
			workspaceSelectionObservation(
				{ ...original, source: { ...original.source, membership: undefined } },
				scope,
				request,
				0
			).access
		).toBe('unknown')
		const member = original.source.membership
		if (!member) throw new Error('Missing fixture membership')
		for (const membership of [
			{ ...member, userId: 'other-user' },
			{ ...member, organizationId: 'other-workspace' }
		]) {
			expect(
				workspaceSelectionObservation(
					{ ...original, source: { ...original.source, membership } },
					scope,
					request,
					0
				).access
			).toBe('denied')
		}
	})
	it.each([
		'',
		'?workspace=',
		'?workspace=invalid',
		`?workspace=${workspaceId}&workspace=${workspaceId}`
	])('does not select malformed or unscoped intent %s', (search) => {
		const original = facts()
		expect(
			workspaceSelectionTarget({ ...original, route: { ...original.route, search } })
		).toBeUndefined()
	})
	it('requires the URL target to match the observed target, with no fallback to directory order', () => {
		const original = facts()
		expect(workspaceSelectionTarget(original)).toBe(workspaceId)
		expect(
			workspaceSelectionTarget({
				...original,
				source: { ...original.source, organizationId: null }
			})
		).toBeUndefined()
	})
})
