import { expect, test } from '@playwright/test'

const fixtureURL = '/__form-presentation'

// Supply the test-only document through Playwright. Vite transforms the entry
// module and actual shared components; no application route is introduced.
test.beforeEach(async ({ page }) => {
	await page.route('**/__form-presentation*', (route) =>
		route.fulfill({
			contentType: 'text/html',
			// Shared form controllers now import the environment-gated inspector.
			// This standalone document needs Kit's generated env bootstrap before
			// importing those controllers, just as the normal app entry does.
			body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Form fixture</title></head><body><script type="module">
import '/.svelte-kit/generated/dev/env/service-worker.js';
import '/src/lib/testing/form-presentation/form-presentation-entry.ts';
</script></body></html>`
		})
	)
})

test(
	'scoped fields react to access; accepted reset rebuilds fields and busy reset preserves them',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.goto(fixtureURL)
		const name = page.getByRole('textbox', { name: 'Name', exact: true })
		await expect(name).toBeEnabled()
		await name.fill('Draft')
		await name.evaluate((node) => node.setAttribute('data-original', 'true'))
		await page.getByRole('button', { name: 'Toggle access', exact: true }).click()
		await expect(name).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
		await page.getByRole('button', { name: 'Toggle access', exact: true }).click()
		await expect(name).toBeEnabled()
		await page.getByRole('button', { name: 'Reset draft', exact: true }).click()
		await expect(name).toHaveValue('')
		await expect(name).not.toHaveAttribute('data-original')
		await expect(page.getByTestId('revision')).toHaveText('1')
		await name.fill('Pending')
		await name.evaluate((node) => node.setAttribute('data-original', 'busy'))
		await page.getByRole('button', { name: 'Save draft', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('operating')
		await expect(name).toBeDisabled()
		await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true')
		await page.getByRole('button', { name: 'Request reset', exact: true }).click()
		await expect(name).toHaveValue('Pending')
		await expect(name).toHaveAttribute('data-original', 'busy')
		await expect(page.getByTestId('revision')).toHaveText('1')
		await page.getByRole('button', { name: 'Finish write', exact: true }).click()
		await expect(page.getByRole('status')).toHaveText('succeeded')
		await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false')
		await page.getByRole('button', { name: 'Reset draft', exact: true }).click()
		await expect(name).toHaveValue('')
		await expect(name).toBeEnabled()
	}
)

test('modal preserves drafts across Escape/backdrop; closes and reopens issued work without cancellation; renders void success', async ({
	page
}) => {
	await page.goto(`${fixtureURL}?modal`)
	const trigger = page.getByRole('button', { name: 'Save draft', exact: true }).first()
	const dialog = page.getByRole('dialog', { name: 'Save draft', exact: true })
	await trigger.click()
	const name = dialog.getByRole('textbox', { name: 'Name', exact: true })
	await name.fill('Keep this draft')
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await page.mouse.click(2, 2)
	await expect(dialog).not.toBeVisible()
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await dialog.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(dialog.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	await expect(page.getByTestId('activity')).toHaveText('operating')
	await trigger.click()
	await expect(name).toHaveValue('Keep this draft')
	await expect(name).toBeDisabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
	await expect(page.getByTestId('cancellations')).toHaveText('0')
	// Settle via the fixture control while the native dialog makes the background inert.
	await page.getByRole('button', { name: 'Finish write', exact: true }).evaluate((node) => {
		if (!(node instanceof HTMLElement)) throw new Error('Expected button')
		node.click()
	})
	await expect(dialog.getByRole('status')).toHaveText('succeeded')
	await expect(dialog.getByRole('textbox')).toHaveCount(0)
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await trigger.click()
	await expect(name).toHaveValue('')
	await expect(name).toBeEnabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
})

test(
	'scope replacement closes the modal and resets its visible draft',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.goto(`${fixtureURL}?modal`)
		const trigger = page.getByRole('button', { name: 'Save draft', exact: true }).first()
		const dialog = page.getByRole('dialog')
		await trigger.click()
		await dialog.getByRole('textbox').fill('Old workspace')
		await page.getByRole('button', { name: 'Replace scope', exact: true }).evaluate((node) => {
			if (!(node instanceof HTMLElement)) throw new Error('Expected button')
			node.click()
		})
		await expect(dialog).not.toBeVisible()
		await trigger.click()
		await expect(dialog.getByRole('textbox')).toHaveValue('')
		await expect(page.getByTestId('starts')).toHaveText('0')
	}
)

test('submission reports render validation and operating activity through the shared controller', async ({
	page
}) => {
	await page.goto(`${fixtureURL}?validation`)
	const name = page.getByRole('textbox', { name: 'Name', exact: true })
	await expect(name).toBeEnabled()
	await name.fill('Reported progress')
	await page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('validating')
	await expect(page.getByTestId('starts')).toHaveText('0')
	await expect(name).toBeDisabled()
	await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true')
	await page.getByRole('button', { name: 'Finish validation', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('operating')
	await expect(page.getByTestId('starts')).toHaveText('1')
	await expect(name).toBeDisabled()
	await page.getByRole('button', { name: 'Finish write', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('idle')
	await expect(page.getByRole('status')).toHaveText('succeeded')
	await expect(page.locator('form')).toHaveAttribute('aria-busy', 'false')
})

test(
	'scope replacement during reported validation waits for cleanup without starting a write',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.goto(`${fixtureURL}?validation`)
		const name = page.getByRole('textbox', { name: 'Name', exact: true })
		await expect(name).toBeEnabled()
		await name.fill('Old scope')
		await page.getByRole('button', { name: 'Save draft', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('validating')
		await page.getByRole('button', { name: 'Replace scope', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('settling')
		await expect(page.getByTestId('starts')).toHaveText('0')
		await page.getByRole('button', { name: 'Finish validation', exact: true }).click()
		await expect(page.getByTestId('activity')).toHaveText('idle')
		await expect(page.getByTestId('starts')).toHaveText('0')
		await expect(page.getByRole('status')).toHaveCount(0)
		await expect(name).toHaveValue('')
		await expect(name).toBeEnabled()
	}
)

test('readiness withdrawal disables submission until a current report arrives', async ({
	page
}) => {
	await page.goto(fixtureURL)
	const name = page.getByRole('textbox', { name: 'Name', exact: true })
	const save = page.getByRole('button', { name: 'Save draft', exact: true })
	await expect(name).toBeEnabled()
	await name.fill('Waiting for fresh readiness')
	await page.getByRole('button', { name: 'Hold readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('observing')
	await expect(name).toBeDisabled()
	await expect(save).toBeDisabled()
	await expect(page.getByTestId('starts')).toHaveText('0')
	await page.getByRole('button', { name: 'Release readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('ready')
	await expect(name).toBeEnabled()
	await expect(name).toHaveValue('Waiting for fresh readiness')
	await save.click()
	await expect(page.getByTestId('starts')).toHaveText('1')
	await page.getByRole('button', { name: 'Finish write', exact: true }).click()
	await expect(page.getByRole('status')).toHaveText('succeeded')
})

test('readiness failure drains pending work before a fresh watcher can recover', async ({
	page
}) => {
	await page.goto(fixtureURL)
	const name = page.getByRole('textbox', { name: 'Name', exact: true })
	const retry = page.getByRole('button', { name: 'Retry readiness', exact: true })
	await expect(name).toBeEnabled()
	await name.fill('Pending original write')
	await page.getByRole('button', { name: 'Save draft', exact: true }).click()
	await expect(page.getByTestId('starts')).toHaveText('1')
	await page.getByRole('button', { name: 'Fail readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('failed')
	await expect(page.getByTestId('activity')).toHaveText('settling')
	await expect(retry).toBeDisabled()
	await page.getByRole('button', { name: 'Repair readiness', exact: true }).click()
	await expect(page.getByTestId('readiness')).toHaveText('failed')
	await page.getByRole('button', { name: 'Finish write', exact: true }).click()
	await expect(page.getByTestId('activity')).toHaveText('idle')
	await expect(retry).toBeEnabled()
	await retry.click()
	await expect(page.getByTestId('readiness')).toHaveText('ready')
	await expect(name).toBeEnabled()
	await expect(page.getByTestId('starts')).toHaveText('1')
})

test(
	'workspace loading feedback is visible while page content waits',
	{ tag: ['@workspaces'] },
	async ({ page }) => {
		await page.goto(fixtureURL)
		await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeEnabled()
		await page.evaluate(async () => {
			const sveltePath = '/node_modules/svelte/src/index-client.js'
			const componentPath = '/src/lib/components/workspaces/WorkspaceScopeNotice.svelte'
			const { mount }: typeof import('svelte') = await import(sveltePath)
			const {
				default: WorkspaceScopeNotice
			}: typeof import('../src/lib/components/workspaces/WorkspaceScopeNotice.svelte') =
				await import(componentPath)
			const target = document.createElement('section')
			target.id = 'workspace-loading-feedback'
			document.body.append(target)
			mount(WorkspaceScopeNotice, {
				target,
				props: { active: true, loading: true, onRetry: () => {} }
			})
		})
		const notice = page.locator('#workspace-loading-feedback')
		await expect(notice.locator('p')).toBeVisible()
		await expect(notice.locator('p')).toHaveText('Loading Workspaces…')
		await expect(notice.getByRole('status')).toHaveText('Loading Workspaces…')
		await expect(notice.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0)
	}
)

test.describe('active application locale', () => {
	test.use({ locale: 'de-DE', timezoneId: 'America/Los_Angeles' })
	test('formats category counts, tag summaries and money with the app locale', async ({ page }) => {
		await page.goto(fixtureURL)
		await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeEnabled()
		await page.evaluate(async () => {
			const sveltePath = '/node_modules/svelte/src/index-client.js'
			const categoryPath = '/src/lib/components/classification/CategoryList.svelte'
			const transactionPath = '/src/lib/components/transactions/TransactionListItem.svelte'
			const { mount }: typeof import('svelte') = await import(sveltePath)
			const {
				default: CategoryList
			}: typeof import('../src/lib/components/classification/CategoryList.svelte') = await import(
				categoryPath
			)
			const {
				default: TransactionListItem
			}: typeof import('../src/lib/components/transactions/TransactionListItem.svelte') =
				await import(transactionPath)
			const target = document.createElement('section')
			target.id = 'locale-presentation-fixture'
			document.body.append(target)
			mount(CategoryList, {
				target,
				props: {
					categories: [
						{
							id: 'category',
							organizationId: 'workspace',
							name: 'User-owned category',
							kind: 'expense',
							isSystem: false,
							archivedAt: null
						}
					],
					counts: new Map([['category', { transactions: 1234, tags: 0 }]]),
					archivableCategoryIds: [],
					archiveView: {
						readiness: { kind: 'ready' },
						content: { kind: 'fields' },
						activity: { kind: 'idle' },
						feedback: { kind: 'none' },
						canSubmit: true,
						canReset: true,
						canOpen: true,
						canCancel: false,
						fieldsEditable: true,
						canRetryReadiness: false,
						draftRevision: 0
					} satisfies import('../src/lib/contracts/management-contract.js').ManagementView<string>,
					onArchive: () => {}
				}
			})
			const list = document.createElement('ul')
			target.append(list)
			mount(TransactionListItem, {
				target: list,
				props: {
					transaction: {
						id: 'transaction',
						organizationId: 'workspace',
						accountId: 'account',
						categoryId: 'category',
						kind: 'expense',
						amountMinor: 123456,
						currency: 'USD',
						bookedOn: '2026-03-10',
						source: 'manual',
						description: 'User-owned description'
					},
					href: '/transactions/transaction',
					categoryName: 'User-owned category',
					accountName: 'User-owned account',
					tagNames: ['Travel', 'Client', 'Project']
				}
			})
		})
		const fixture = page.locator('#locale-presentation-fixture')
		const cells = fixture.getByRole('row').nth(1).getByRole('cell')
		await expect(cells.nth(1)).toHaveText('1,234')
		await expect(cells.nth(2)).toHaveText('0')
		await expect(fixture.getByRole('listitem')).toContainText('Travel, Client, Project')
		await expect(fixture.getByRole('link')).toHaveAccessibleName(
			/Transaction details: User-owned category, User-owned description, \$1,234\.56/
		)
		await expect(fixture.getByText('User-owned description', { exact: true })).toBeVisible()
	})
})
