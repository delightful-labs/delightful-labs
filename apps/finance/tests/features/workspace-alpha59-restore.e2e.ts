import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { parseArchivePayload } from 'delightful-local-first/backup/archive'
import {
	financeRestorePlanningMachine,
	prepareFinanceRestorePlan
} from '../../src/lib/machines/workspaces/workspace-restore-plan.js'
import { installWorkspaceSettingsTest, start as startWorkspace } from '../helpers/workspace.js'
import { createActor, toPromise } from 'xstate'

function business(row: Record<string, unknown>, translate: (value: unknown) => unknown) {
	return Object.fromEntries(
		Object.entries(row)
			.filter(
				([key]) =>
					!key.startsWith('sourceCreated') &&
					!key.startsWith('sourceUpdated') &&
					!key.startsWith('$') &&
					key !== '_restoreOperationId' &&
					key !== 'restoreOperationId' &&
					key !== 'originalBytes'
			)
			.map(([key, value]) => [key, translate(value)])
	)
}

for (const version of [1, 2]) {
	const fixture = fileURLToPath(
		new URL(`../fixtures/backup-compatibility/finance-alpha59-v${version}.dlf`, import.meta.url)
	)
	const source = parseArchivePayload(
		new Uint8Array(
			await readFile(
				new URL(
					`../fixtures/backup-compatibility/finance-alpha59-v${version}.expected.json`,
					import.meta.url
				)
			)
		)
	)
	const sourceOwner = source.records.find((row) => row.type === 'organizations')?.fields.ownerId
	if (!sourceOwner || sourceOwner.kind !== 'text') throw new Error('Missing synthetic source owner')

	test(
		`restores an actual alpha.59 v${version} Finance archive into alpha.60 without losing its graph or bytes`,
		{ tag: ['@workspaces', '@backup'] },
		async ({ page }) => {
			test.setTimeout(120_000)
			await startWorkspace(page)
			await expect(page.getByLabel('Current Workspace', { exact: true })).not.toHaveValue('')
			await installWorkspaceSettingsTest(page)
			const restore = page.getByRole('region', { name: 'Restore Workspace', exact: true })
			await restore.getByLabel('Backup', { exact: true }).setInputFiles(fixture)
			await restore.getByRole('button', { name: 'Restore Workspace', exact: true }).click()
			await restore.getByRole('button', { name: 'Create Workspace', exact: true }).click()
			await expect(restore.getByRole('status')).toHaveText('Done', { timeout: 90_000 })

			const actual = await page.evaluate(async () => {
				const { db, app, userId } = window.workspaceSettingsTest
				const root = (await db.all(app.organizations, { tier: 'remote' })).find(
					(row) => row.name === 'Exact household'
				)
				if (!root) throw new Error('Restored workspace not active')
				const transactions = await db.all(app.transactions.where({ organizationId: root.id }), {
					tier: 'remote'
				})
				const files = await db.all(
					app.files.where({ transactionId: { in: transactions.map((row) => row.id) } }),
					{ tier: 'remote' }
				)
				const parts = await db.all(
					app.fileParts.where({ fileId: { in: files.map((row) => row.id) } }).orderBy('partIndex'),
					{ tier: 'remote' }
				)
				const operations = await db.all(app.restoreOperations.where({ workspaceId: root.id }), {
					tier: 'remote'
				})
				const operation = operations[0]
				if (!operation || operations.length !== 1)
					throw new Error('Missing unique restore operation')
				const sourceParts = await db.all(
					app.fileParts.where({ fileId: operation.sourceFileId }).orderBy('partIndex'),
					{ tier: 'remote' }
				)
				return {
					identityId: userId,
					workspaceId: root.id,
					operationId: operation.id,
					status: operation.status,
					applicationId: `${location.origin}/jazz`,
					environment: location.origin,
					rows: {
						organizations: [root],
						transactions,
						files,
						accounts: await db.all(app.accounts.where({ organizationId: root.id }), {
							tier: 'remote'
						}),
						categories: await db.all(app.categories.where({ organizationId: root.id }), {
							tier: 'remote'
						}),
						tags: await db.all(app.tags.where({ organizationId: root.id }), { tier: 'remote' }),
						checks: await db.all(app.checks.where({ organizationId: root.id }), { tier: 'remote' }),
						internalTransfers: await db.all(
							app.internalTransfers.where({ organizationId: root.id }),
							{ tier: 'remote' }
						),
						transactionTags: await db.all(app.transactionTags.where({ organizationId: root.id }), {
							tier: 'remote'
						}),
						transactionBatches: await db.all(
							app.transactionBatches.where({ organizationId: root.id }),
							{ tier: 'remote' }
						),
						batchTemplates: await db.all(app.batchTemplates.where({ organizationId: root.id }), {
							tier: 'remote'
						}),
						transactionAttachments: await db.all(
							app.transactionAttachments.where({ fileId: { in: files.map((row) => row.id) } }),
							{ tier: 'remote' }
						)
					},
					members: await db.all(app.organizationMembers.where({ organizationId: root.id }), {
						tier: 'remote'
					}),
					attachment: parts.flatMap((part) => [...(part.data ?? [])]),
					sourceBytes: sourceParts.flatMap((part) => [...(part.data ?? [])])
				}
			})
			expect(actual.status).toBe('active')
			expect(actual.rows.organizations[0]).toMatchObject({ restoreOperationId: actual.operationId })
			expect(parseArchivePayload(new Uint8Array(actual.sourceBytes))).toEqual(source)
			const opening = prepareArchiveOpen(new Uint8Array(await readFile(fixture)))
			const checked = await toPromise(
				createActor(createArchiveEnvelopeMachine(), { input: { request: opening } }).start()
			)
			if (checked.outcome !== 'integrityChecked')
				throw new Error('Legacy fixture failed independent reopening')
			const planning = prepareFinanceRestorePlan(checked.archive, {
				applicationId: actual.applicationId,
				environment: actual.environment,
				identityId: actual.identityId,
				workspaceId: source.source.workspaceId,
				operationId: actual.operationId,
				generation: 0
			})
			try {
				const result = await toPromise(
					createActor(financeRestorePlanningMachine, { input: { request: planning } }).start()
				)
				if (result.outcome !== 'planned')
					throw new Error('Legacy fixture failed independent planning')
				const reverse = new Map(
					result.plan
						.read()
						.intent.plan.mappings.map((mapping) => [mapping.destinationId, mapping.sourceId])
				)
				const translate = (value: unknown): unknown =>
					value === actual.identityId
						? sourceOwner.value
						: typeof value === 'string'
							? (reverse.get(value) ?? value)
							: value instanceof Date
								? value.toISOString()
								: value
				const sorted = (rows: Record<string, unknown>[]) =>
					rows.sort((a, b) => String(a.id).localeCompare(String(b.id)))
				for (const [type, rows] of Object.entries(actual.rows)) {
					const expected = source.records
						.filter((row) => row.type === type)
						.map((row) =>
							business(
								{
									id: row.id,
									...Object.fromEntries(
										Object.entries(row.fields).map(([key, value]) => [
											key,
											value.kind === 'null'
												? null
												: value.kind === 'integer'
													? Number(value.value)
													: value.kind === 'reference' || value.kind === 'attachment'
														? value.id
														: value.value
										])
									)
								},
								(value) => value
							)
						)
					expect(sorted(rows.map((row) => business(row, translate))), type).toEqual(
						sorted(expected)
					)
				}
				expect(actual.attachment).toEqual([...Buffer.from(source.attachments[0]!.data, 'base64')])
				expect(actual.members).toHaveLength(1)
				expect(actual.members[0]).toMatchObject({ userId: actual.identityId, role: 'owner' })
			} finally {
				planning.release()
				checked.archive.release()
				opening.release()
			}
			await restore.getByRole('button', { name: 'Open Workspace', exact: true }).click()
			await expect(page).toHaveURL(
				(url) => url.searchParams.get('workspace') === actual.workspaceId
			)
			await page.reload()
			await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(
				actual.workspaceId
			)
		}
	)
}
