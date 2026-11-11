import { describe, expect, it } from 'vitest'
import type { OrganizationMember } from '../schema.js'
import { canManageBankCredentials } from './organization-permissions.js'

function membership(role: NonNullable<OrganizationMember['role']>, organizationId = 'workspace') {
	return { role, organizationId } as OrganizationMember
}

describe('canManageBankCredentials', () => {
	it.each(['owner', 'admin'] as const)('allows %s members in the matching organization', (role) => {
		expect(canManageBankCredentials(membership(role), 'workspace')).toBe(true)
	})

	it.each(['member', 'viewer'] as const)('denies %s members', (role) => {
		expect(canManageBankCredentials(membership(role), 'workspace')).toBe(false)
	})

	it('denies a membership from a different organization', () => {
		expect(canManageBankCredentials(membership('admin', 'other-workspace'), 'workspace')).toBe(false)
	})

	it.each([null, undefined])('denies a missing membership (%s)', (value) => {
		expect(canManageBankCredentials(value, 'workspace')).toBe(false)
	})
})
