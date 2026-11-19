import { financeFixture } from './helpers/worker-fixture.js'
import type { InsertOf } from 'jazz-tools'
import { prepareSidebar } from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'
import type { OrganizationMember } from '../src/lib/queries.js'

declare global {
	interface Window {
		workspacePermissionTest: {
			db: ReturnType<typeof import('jazz-tools/svelte').getDb>
			app: typeof import('../src/lib/queries.js').app
			userId: string
		}
	}
}
type Role = NonNullable<OrganizationMember['role']>
type Mode = OrganizationMember['accountAccessMode']

const scenarios: {
	name: string
	role?: Role
	mode: Mode
	grant?: 'read' | 'write'
	read: boolean
	write: boolean
	all: boolean
}[] = [
	{ name: 'unrelated user', mode: 'selected', read: false, write: false, all: false },
	{ name: 'admin', role: 'admin', mode: 'selected', read: true, write: true, all: true },
	{
		name: 'member with all access',
		role: 'member',
		mode: 'all',
		read: true,
		write: true,
		all: true
	},
	{
		name: 'viewer with all access',
		role: 'viewer',
		mode: 'all',
		read: true,
		write: false,
		all: true
	},
	{
		name: 'member with no grants',
		role: 'member',
		mode: 'selected',
		read: false,
		write: false,
		all: false
	},
	{
		name: 'member with a read grant',
		role: 'member',
		mode: 'selected',
		grant: 'read',
		read: true,
		write: false,
		all: false
	},
	{
		name: 'member with a write grant',
		role: 'member',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: true,
		all: false
	},
	{
		name: 'viewer with a write grant',
		role: 'viewer',
		mode: 'selected',
		grant: 'write',
		read: true,
		write: false,
		all: false
	},
	{
		name: 'grant without membership',
		mode: 'selected',
		grant: 'write',
		read: false,
		write: false,
		all: false
	}
]

async function start(page: Page) {
	await page.goto('/')
	await expect(page.getByRole('complementary').getByRole('navigation')).toBeVisible()
	await prepareSidebar(page)
	const workspace = page.getByLabel('Current Workspace', { exact: true })
	await expect(workspace).toHaveValue(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
	)
	await financeFixture(page, 'permissions.e2e:98')
}

test(
	'cannot move a category into an unrelated workspace',
	{ tag: ['@permissions', '@workspaces', '@categories'] },
	async ({ page, browser }) => {
		await start(page)
		const targetOrganizationId = await page
			.getByLabel('Current Workspace', { exact: true })
			.inputValue()
		const subjectContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
		try {
			const subject = await subjectContext.newPage()
			await start(subject)
			const organizationId = await subject
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const outcome = await financeFixture(subject, 'permissions.e2e:126', {
				organizationId,
				targetOrganizationId
			})
			expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			const injected = await financeFixture(page, 'permissions.e2e:149', targetOrganizationId)
			expect(injected).toHaveLength(0)
		} finally {
			await subjectContext.close()
		}
	}
)

for (const scenario of scenarios) {
	test(
		`workspace access: ${scenario.name}`,
		{ tag: ['@permissions', '@workspaces', '@accounts', '@transactions'] },
		async ({ page, browser }) => {
			await start(page)
			const subjectContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await subjectContext.newPage()
				await start(subject)
				const subjectId = await financeFixture(subject, 'permissions.e2e:172')
				if (!subjectId) throw new Error('Test identity is missing.')
				const organizationId = await page
					.getByLabel('Current Workspace', { exact: true })
					.inputValue()
				const fixture = await financeFixture(page, 'permissions.e2e:177', {
					organizationId,
					subjectId,
					role: scenario.role,
					mode: scenario.mode,
					grant: scenario.grant
				})

				const access = await financeFixture(subject, 'permissions.e2e:263', {
					organizationId,
					fixture
				})
				expect(access.workspace).toBe(Boolean(scenario.role))
				expect(access.transaction).toBe(scenario.read)
				expect(access.credentialEnvelope).toBe(scenario.role === 'admin')
				expect(access.rows.sort()).toEqual(
					(scenario.all
						? [fixture.firstId, fixture.secondId]
						: scenario.read
							? [fixture.firstId]
							: []
					).sort()
				)

				const outcome = await financeFixture(subject, 'permissions.e2e:298', {
					id: fixture.firstId,
					organizationId,
					read: scenario.read
				})
				if (scenario.write) expect(outcome).toBe('accepted')
				else expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
				const savedName = await financeFixture(page, 'permissions.e2e:325', fixture.firstId)
				expect(savedName).toBe(scenario.write ? 'Changed by subject' : 'Shared checking')
				const savedAccounts = await financeFixture(page, 'permissions.e2e:330', organizationId)
				expect(savedAccounts).toBe(2)
			} finally {
				await subjectContext.close()
			}
		}
	)
}

test(
	'transaction tags enforce workspace consistency, active assignment, immutable links, and archived history',
	{ tag: ['@transactions', '@tags', '@workflow-completion', '@permissions', '@workspaces'] },
	async ({ page }) => {
		await start(page)
		const organizationId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const result = await financeFixture(page, 'permissions.e2e:348', organizationId)
		expect(result.outcomes).toHaveLength(6)
		for (const outcome of result.outcomes)
			expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
		expect(result.retained).toBe(true)
		expect(result.removed).toBe(true)
	}
)

for (const scenario of scenarios) {
	test(
		`transaction tag permissions: ${scenario.name}`,
		{ tag: ['@transactions', '@permissions', '@tags'] },
		async ({ page, browser }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const subjectContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
			try {
				const subject = await subjectContext.newPage()
				await start(subject)
				const subjectId = await financeFixture(subject, 'permissions.e2e:460')
				const fixture = await financeFixture(page, 'permissions.e2e:461', {
					organizationId,
					subjectId,
					role: scenario.role,
					mode: scenario.mode,
					grant: scenario.grant
				})
				const access = await financeFixture(subject, 'permissions.e2e:528', {
					organizationId,
					fixture
				})
				expect(access.read).toBe(scenario.read)
				if (scenario.write) {
					expect(access.insert).toBe('accepted')
					expect(access.remove).toBe('accepted')
				} else {
					expect(access.insert).toMatch(/AuthorizationDenied|permission_denied/)
					expect(access.remove).toMatch(/AuthorizationDenied|permission_denied/)
				}
				const retained = await financeFixture(page, 'permissions.e2e:564', fixture.linkId)
				expect(retained).toBe(!scenario.write)
			} finally {
				await subjectContext.close()
			}
		}
	)
}

test(
	'Check references enforce scope and permit reuse without an exclusivity rule',
	{ tag: ['@permissions', '@workspaces', '@transactions'] },
	async ({ page }) => {
		await start(page)
		const result = await financeFixture(page, 'permissions.e2e:581')
		expect(result.firstId).not.toBe(result.secondId)
		for (const outcome of [result.missingCheck, result.mismatchedMethod, result.mismatchedAccount])
			expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
		expect(result.retained).toMatchObject({ checkNumber: '456', checkDate: '2026-10-15' })
	}
)

for (const kind of ['expense', 'income'] satisfies ('expense' | 'income')[]) {
	test(
		`permission integrity: ${kind} tag compatibility and income methods`,
		{ tag: ['@permissions', '@tags', '@transactions'] },
		async ({ page }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const results = await financeFixture(page, 'permissions.e2e:682', { organizationId, kind })
			for (const outcome of results.denied)
				expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
			for (const outcome of results.invalidKinds) expect(outcome).not.toBe('accepted')
			expect(results.retained).toBe(true)
			if (kind === 'income') {
				expect(results.imported).toBeTruthy()
				expect(results.manualWithoutMethod).toBeTruthy()
			}
		}
	)
}
