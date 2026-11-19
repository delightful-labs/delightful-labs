import { financeFixture } from '../helpers/worker-fixture.js'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { financeBackupProfile } from '../../src/lib/backup/workspace.js'

import { expect } from '@playwright/test'
import { test, start, installWorkspaceSettingsTest } from '../helpers/workspace.js'
import { openCreationModal, selectWorkspace, navigateSidebar } from '../helpers/ui.js'
import { createActor, toPromise } from 'xstate'

test(
	'owner can rename, reject whitespace, retry, and retain the name after reload',
	{ tag: ['@workspace-rename', '@workspaces'] },
	async ({ page }) => {
		// Console events can disappear during teardown; retain action warnings across reload.
		await page.addInitScript(() => {
			const warn = console.warn.bind(console)
			console.warn = (...args) => {
				if (String(args[0]).includes('Custom actions should not call')) {
					sessionStorage.setItem('workspace-action-warning', String(args[0]))
				}
				warn(...args)
			}
		})
		await start(page)
		const workspaceId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		const name = page.getByRole('textbox', { name: 'Workspace name', exact: true })
		const save = page.getByRole('button', { name: 'Save', exact: true })
		await name.fill('   ')
		await save.click()
		await expect(page.getByRole('alert').filter({ hasText: 'Enter Workspace name' })).toHaveText(
			'Enter Workspace name'
		)
		await name.fill('  Household  ')
		await save.click()
		await expect(
			page.getByRole('main').getByRole('status').filter({ hasText: 'Workspace settings saved.' })
		).toHaveText('Workspace settings saved.')
		await expect(
			page.getByLabel('Current Workspace', { exact: true }).locator('option:checked')
		).toHaveText('Household')
		await page.reload()
		await expect(name).toHaveValue('Household')
		await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
		await expect(save).toBeDisabled()
		expect(await page.evaluate(() => sessionStorage.getItem('workspace-action-warning'))).toBeNull()

		const currency = page.locator('#workspace-default-currency')
		await expect(currency).toHaveValue('USD')
		await currency.selectOption('TZS')
		await save.click()
		await expect(
			page.getByRole('main').getByRole('status').filter({ hasText: 'Workspace settings saved.' })
		).toHaveText('Workspace settings saved.')
		await expect(currency).toHaveValue('TZS')
		await page.reload()
		await expect(currency).toHaveValue('TZS')

		await page.goto(`/accounts?workspace=${workspaceId}`)
		const accountDialog = await openCreationModal(page, 'Add Account')
		await expect(accountDialog.getByLabel('Currency', { exact: true })).toHaveValue('TZS')
		await accountDialog.getByLabel('Account name').fill('Default currency wallet')
		await accountDialog.getByLabel('Account type').selectOption('cash')
		await accountDialog.getByRole('button', { name: 'Add Account', exact: true }).click()
		await expect(accountDialog.getByRole('status')).toHaveText(
			'Account Default currency wallet saved.'
		)
		await accountDialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('cell', { name: 'TZS', exact: true })
		).toBeVisible()
	}
)

for (const role of ['admin', 'member', 'viewer']) {
	test(
		`${role} has the correct rename access in a shared workspace`,
		{ tag: ['@workspace-rename', '@workspaces', '@permissions'] },
		async ({ page, browser, baseURL }) => {
			await start(page)
			const organizationId = await page
				.getByLabel('Current Workspace', { exact: true })
				.inputValue()
			const otherContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
			try {
				const subject = await otherContext.newPage()
				await start(subject)
				const ownWorkspaceId = await subject
					.getByLabel('Current Workspace', { exact: true })
					.inputValue()
				const subjectId = await financeFixture(subject, 'features/workspace-settings.e2e:92')
				await financeFixture(page, 'features/workspace-settings.e2e:93', {
					organizationId,
					subjectId,
					role
				})
				// Reopen to obtain the grant and recreate bindings for the new document.
				await subject.reload()
				await installWorkspaceSettingsTest(subject)
				const selector = subject.getByLabel('Current Workspace', { exact: true })
				await expect(selector.locator(`option[value="${organizationId}"]`)).toHaveCount(1)
				await selectWorkspace(selector, organizationId)
				const name = subject.getByRole('textbox', { name: 'Workspace name', exact: true })
				const currency = subject.locator('#workspace-default-currency')
				const save = subject.getByRole('button', { name: 'Save', exact: true })
				await expect(name).toHaveValue('Shared workspace')
				await expect(
					subject.getByRole('button', { name: 'Download Backup', exact: true })
				).toBeDisabled()
				await expect(currency).toHaveValue('USD')
				if (role === 'admin') {
					await expect(name).toBeEditable()
					await expect(currency).toBeEnabled()
					await currency.selectOption('TZS')
					await name.fill('Admin renamed workspace')
					await save.click()
					await expect(
						subject
							.getByRole('main')
							.getByRole('status')
							.filter({ hasText: 'Workspace settings saved.' })
					).toHaveText('Workspace settings saved.')
					await expect(
						page.getByRole('textbox', { name: 'Workspace name', exact: true })
					).toHaveValue('Admin renamed workspace')
				} else {
					await expect(name).not.toBeEditable()
					await expect(currency).toBeDisabled()
					await expect(save).toBeDisabled()
					await expect(
						subject.getByText('You do not have permission to make this change.')
					).toBeVisible()
					const outcome = await financeFixture(
						subject,
						'features/workspace-settings.e2e:148',
						organizationId
					)
					expect(outcome).toMatch(/AuthorizationDenied|permission_denied/)
					const savedName = await financeFixture(
						page,
						'features/workspace-settings.e2e:160',
						organizationId
					)
					expect(savedName).toBe('Shared workspace')
				}
				await selectWorkspace(selector, ownWorkspaceId)
				await expect(name).toBeEditable()
				await expect(save).toBeDisabled()
				await expect(name).not.toHaveValue('Shared workspace')
			} finally {
				await otherContext.close()
			}
		}
	)
}

test.describe('workspace backup downloads', () => {
	// These measurements share one disposable server; seed and export one large scope at a time.
	test.describe.configure({ mode: 'default' })
	test(
		'failed backup release remains recoverable after leaving settings',
		{ tag: ['@workspaces', '@backup'] },
		async ({ page }) => {
			await start(page)
			const identity = await financeFixture(page, 'features/workspace-settings.e2e:187')
			await page.locator('#workspace-backup-protection').selectOption('none')
			await page.getByRole('button', { name: 'Download Backup', exact: true }).click()
			await expect(
				page.getByRole('alert').filter({ hasText: 'Couldn’t complete the request.' })
			).toBeVisible()
			await expect(
				page.getByRole('button', { name: 'Download Backup', exact: true })
			).toBeDisabled()
			await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
			expect(await page.evaluate(() => sessionStorage.getItem('backup-test-commit-attempt'))).toBe(
				'1'
			)
			await navigateSidebar(page, 'Overview')
			const retry = page.getByRole('main').getByRole('button', { name: 'Try again', exact: true })
			await expect(retry).toBeVisible()
			await Promise.all([
				page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() }),
				retry.click()
			])
			await expect(page.getByLabel('Current Workspace', { exact: true })).not.toHaveValue('')
			await installWorkspaceSettingsTest(page)
			expect(await financeFixture(page, 'features/workspace-settings.e2e:226')).toBe(identity)
			expect(await page.evaluate(() => sessionStorage.getItem('backup-test-commit-attempt'))).toBe(
				'1'
			)
		}
	)
	for (const protection of ['password', 'none']) {
		test(
			`downloads and independently reopens a Finance ${protection} backup without changing source`,
			{ tag: ['@workspaces', '@backup'] },
			async ({ page }, info) => {
				// This flow seeds, exports, restores and independently verifies 521 transactions.
				test.setTimeout(180_000)
				await start(page)
				const source = await financeFixture(page, 'features/workspace-settings.e2e:240')
				await page.locator('#workspace-backup-protection').selectOption(protection)
				if (protection === 'password')
					await page.locator('#workspace-backup-password').fill('independent-browser-password')
				const responsiveness = await page.evaluateHandle(() => {
					const stats = { longestTaskMs: 0 }
					const observer = new PerformanceObserver((list) => {
						for (const entry of list.getEntries())
							stats.longestTaskMs = Math.max(stats.longestTaskMs, entry.duration)
					})
					observer.observe({ entryTypes: ['longtask'] })
					return { stats, observer }
				})
				const started = performance.now(),
					downloaded = page.waitForEvent('download')
				await page.getByRole('button', { name: 'Download Backup', exact: true }).click()
				const download = await downloaded,
					path = await download.path()
				expect(await download.failure()).toBeNull()
				if (!path) throw new Error('Missing retained download')
				await expect(
					page.getByRole('status').filter({ hasText: 'Download started.' })
				).toBeVisible()
				const bytes = new Uint8Array(await readFile(path)),
					request = prepareArchiveOpen(
						bytes,
						protection === 'password' ? 'independent-browser-password' : undefined
					)
				const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } }).start(),
					opened = await toPromise(actor)
				expect(opened.outcome).toBe('integrityChecked')
				if (opened.outcome !== 'integrityChecked') throw new Error('Independent reopening failed')
				const payload = opened.archive.readPayload()
				expect(financeBackupProfile.validate(payload)).toBe(true)
				expect(payload.records.filter((row) => row.type === 'transactions')).toHaveLength(521)
				expect(payload.source.workspaceId).toBe(source.organizationId)
				expect(Buffer.from(payload.attachments[0]?.data ?? '', 'base64')).toEqual(
					Buffer.from([0, 1, 127, 255, 9, 8, 7, 6])
				)
				expect(
					payload.records.find((row) => row.id === source.transactionId)?.fields.description
				).toEqual({ kind: 'text', value: 'Exact transaction 0' })
				const after = await financeFixture(
					page,
					'features/workspace-settings.e2e:352',
					source.organizationId
				)
				expect(after).toBe(source.records)
				const measurement = {
					protection,
					records: payload.records.length + payload.references.length,
					attachmentBytes: payload.attachments.reduce((sum, file) => sum + file.sizeBytes, 0),
					fileBytes: bytes.length,
					totalExportAndOpenMs: Math.round(performance.now() - started),
					longestMainThreadTaskMs: Math.round(
						await responsiveness.evaluate(({ stats, observer }) => {
							observer.disconnect()
							return stats.longestTaskMs
						})
					)
				}
				console.log('Finance backup measurement', measurement)
				await info.attach('finance-backup-measurement', {
					body: JSON.stringify(measurement),
					contentType: 'application/json'
				})

				// Restore from the actual downloaded file through the root-owned UI.
				const restoreRegion = page.getByRole('region', { name: 'Restore Workspace', exact: true })
				const beforeIds = await financeFixture(page, 'features/workspace-settings.e2e:384')
				if (protection === 'none') {
					await restoreRegion.getByLabel('Backup', { exact: true }).setInputFiles({
						name: 'invalid.dlf',
						mimeType: 'application/octet-stream',
						buffer: Buffer.from('invalid backup')
					})
					await restoreRegion
						.getByRole('button', { name: 'Restore Workspace', exact: true })
						.click()
					await expect(restoreRegion.getByRole('alert')).toContainText(
						'Couldn’t complete the request.'
					)
				}
				if (protection === 'password') {
					await restoreRegion.getByLabel('Backup', { exact: true }).setInputFiles(path)
					await restoreRegion.getByLabel('Password', { exact: true }).fill('wrong-password')
					await restoreRegion
						.getByRole('button', { name: 'Restore Workspace', exact: true })
						.click()
					await expect(restoreRegion.getByRole('alert')).toContainText(
						'Couldn’t complete the request.'
					)
					expect(await financeFixture(page, 'features/workspace-settings.e2e:415')).toEqual(
						beforeIds
					)
				}
				await restoreRegion.getByLabel('Backup', { exact: true }).setInputFiles(path)
				if (protection === 'password')
					await restoreRegion
						.getByLabel('Password', { exact: true })
						.fill('independent-browser-password')
				await restoreRegion.getByRole('button', { name: 'Restore Workspace', exact: true }).click()
				await expect(
					restoreRegion.getByRole('button', { name: 'Create Workspace', exact: true })
				).toBeVisible()
				expect(await financeFixture(page, 'features/workspace-settings.e2e:435')).toEqual(beforeIds)
				if (protection === 'none') {
					await navigateSidebar(page, 'Overview')
					await expect(
						restoreRegion.getByRole('button', { name: 'Create Workspace', exact: true })
					).toBeVisible()
					await restoreRegion.getByRole('button', { name: 'Cancel', exact: true }).click()
					await expect(restoreRegion.getByRole('status')).toHaveText('The request was cancelled.')
					await navigateSidebar(page, 'Workspaces')
					await installWorkspaceSettingsTest(page)
					await restoreRegion.getByLabel('Backup', { exact: true }).setInputFiles(path)
					await restoreRegion
						.getByRole('button', { name: 'Restore Workspace', exact: true })
						.click()
					await expect(
						restoreRegion.getByRole('button', { name: 'Create Workspace', exact: true })
					).toBeVisible()
				}
				const restoreStarted = performance.now()
				await restoreRegion.getByRole('button', { name: 'Create Workspace', exact: true }).click()
				if (protection === 'none') await navigateSidebar(page, 'Overview')
				// Native acceptance of this graph can exceed 30s; the overall test deadline still applies.
				await expect(restoreRegion.getByRole('status')).toHaveText('Done', {
					timeout: info.timeout
				})
				const restoreMeasurement = {
					protection,
					transactions: 521,
					totalRestoreMs: Math.round(performance.now() - restoreStarted)
				}
				console.log('Finance restore measurement', restoreMeasurement)
				await info.attach('finance-restore-measurement', {
					body: JSON.stringify(restoreMeasurement),
					contentType: 'application/json'
				})
				const restored = await financeFixture(
					page,
					'features/workspace-settings.e2e:478',
					beforeIds
				)
				expect(restored).toMatchObject({
					roots: beforeIds.length + 1,
					transactions: 521,
					operationCount: 1
				})
				expect(restored.descriptions).toEqual(
					Array.from({ length: 521 }, (_, index) => 'Exact transaction ' + index).sort()
				)
				expect(restored.facts).toEqual(
					Array.from({ length: 521 }, (_, index) => ({
						description: 'Exact transaction ' + index,
						amountMinor: index + 1,
						currency: 'USD',
						bookedOn: '2026-11-01',
						kind: 'expense',
						source: 'manual'
					}))
				)
				expect(restored.attachment).toEqual([0, 1, 127, 255, 9, 8, 7, 6])
				expect(restored.members).toHaveLength(1)
				expect(restored.members[0]?.role).toBe('owner')
				expect(await financeFixture(page, 'features/workspace-settings.e2e:545', source)).toBe(
					source.records
				)
				await restoreRegion.getByRole('button', { name: 'Open Workspace', exact: true }).click()
				await expect(page).toHaveURL((url) => url.searchParams.get('workspace') === restored.id)
				await installWorkspaceSettingsTest(page)
				await restoreRegion.getByLabel('Backup', { exact: true }).setInputFiles(path)
				if (protection === 'password')
					await restoreRegion
						.getByLabel('Password', { exact: true })
						.fill('independent-browser-password')
				await restoreRegion.getByRole('button', { name: 'Restore Workspace', exact: true }).click()
				await expect(restoreRegion.getByRole('status')).toHaveText('Done', {
					timeout: info.timeout
				})
				expect(await financeFixture(page, 'features/workspace-settings.e2e:573')).toBe(
					beforeIds.length + 1
				)

				await responsiveness.dispose()
				opened.archive.release()
				request.release()
				if (protection === 'password')
					await expect(page.locator('#workspace-backup-password')).toHaveValue('')
			}
		)
	}
})
