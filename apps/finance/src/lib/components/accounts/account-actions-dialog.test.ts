import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import type { ComponentProps } from 'svelte'
import AccountActionsDialog from './AccountActionsDialog.svelte'

const props = {
	account: {
		id: 'account',
		organizationId: 'workspace',
		name: 'Cash',
		kind: 'cash',
		currency: 'USD',
		archivedAt: null
	},
	archiveAction: 'available',
	deleteGrantView: {
		busy: false,
		result: undefined,
		canManage: true,
		members: [
			{
				id: 'member',
				organizationId: 'workspace',
				userId: 'colleague',
				profileId: null,
				role: 'member',
				accountAccessMode: 'selected'
			}
		],
		grants: [
			{
				id: 'grant',
				organizationId: 'workspace',
				accountId: 'account',
				userId: 'colleague',
				access: 'read',
				canDelete: true
			}
		]
	},
	grantQueries: [{ isLoading: false, error: null }],
	open: true,
	onArchive: () => {},
	onDeleteGrant: () => {}
} satisfies ComponentProps<typeof AccountActionsDialog>

describe('account actions permission-data presentation', () => {
	it('shows the granted control when permission data is ready', () => {
		const { body } = render(AccountActionsDialog, { props })
		expect(body).toContain('Allow colleague to delete transactions')
		expect(body).toContain('checked')
	})

	it('keeps Archive available while permission data loads without showing incomplete controls', () => {
		const { body } = render(AccountActionsDialog, {
			props: { ...props, grantQueries: [{ isLoading: true, error: null }] }
		})
		expect(body).toContain('Loading Permissions')
		expect(body).not.toContain('Allow colleague to delete transactions')
		expect(body).toContain('Archive')
		expect(body).not.toMatch(/<button[^>]*disabled/)
	})

	it('keeps Archive available after a permission query fails', () => {
		const { body } = render(AccountActionsDialog, {
			props: { ...props, grantQueries: [{ isLoading: false, error: new Error('Unavailable') }] }
		})
		expect(body).toContain('Could not load Permissions.')
		expect(body).not.toContain('Allow colleague to delete transactions')
		expect(body).not.toMatch(/<button[^>]*disabled/)
	})

	it('hides permission controls when the viewer cannot manage grants', () => {
		const { body } = render(AccountActionsDialog, {
			props: { ...props, deleteGrantView: { ...props.deleteGrantView, canManage: false } }
		})
		expect(body).toContain('Only workspace owners and admins can manage this permission.')
		expect(body).not.toContain('Allow colleague to delete transactions')
	})
})
