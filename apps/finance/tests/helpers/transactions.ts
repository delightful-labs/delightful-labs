import { expect, type Page } from '@playwright/test'

export async function seedTransaction(
	page: Page,
	scenario:
		| 'manual'
		| 'imported'
		| 'imported-income'
		| 'archived'
		| 'viewer'
		| 'check'
		| 'expense-check'
		| 'transfer' = 'manual'
) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
	return page.evaluate(async (scenario) => {
		// These provider rows represent already-synced endpoints. A later transaction's
		// permission checks cannot rely on unaccepted writes from this fixture.
		const tier = scenario === 'transfer' ? 'global' : 'local'
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Test session is not ready.')
		const db = snapshot.client.db
		const [organization] = await db.all(app.organizations)
		if (!organization) throw new Error('Missing organization.')
		const account = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Editable ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier })
		const destination =
			scenario === 'check' || scenario === 'transfer'
				? await db
						.insert(app.accounts, {
							organizationId: organization.id,
							name: 'Destination ledger',
							kind: 'cash',
							currency: 'USD'
						})
						.wait({ tier })
				: null
		const category = await db
			.insert(app.categories, {
				organizationId: organization.id,
				name: 'Editable category',
				kind: scenario === 'check' || scenario === 'imported-income' ? 'income' : 'expense',
				isSystem: false
			})
			.wait({ tier })
		const base = {
			organizationId: organization.id,
			accountId: account.id,
			categoryId: category.id,
			amountMinor: scenario === 'transfer' ? 100 : 1234,
			currency: 'USD',
			bookedOn: scenario === 'transfer' ? '2026-10-25' : '2026-10-18',
			memo: 'Original memo'
		}
		const isIncome = scenario === 'check' || scenario === 'imported-income'
		const check =
			scenario === 'check' || scenario === 'expense-check'
				? await db
						.insert(app.checks, {
							organizationId: organization.id,
							accountId: account.id,
							checkNumber: '100',
							checkDate: base.bookedOn
						})
						.wait({ tier })
				: null
		const destinationCategory =
			scenario === 'transfer'
				? await db
						.insert(app.categories, {
							organizationId: organization.id,
							name: 'Destination category',
							kind: 'income',
							isSystem: false
						})
						.wait({ tier })
				: null
		const saved = await db
			.insert(app.transactions, {
				...base,
				kind: isIncome ? 'income' : 'expense',
				source:
					scenario === 'imported' || scenario === 'imported-income' || scenario === 'transfer'
						? 'simplefin'
						: 'manual',
				...(scenario === 'imported' || scenario === 'imported-income' || scenario === 'transfer'
					? { externalId: 'imported-edit-test' }
					: {}),
				...(check ? { paymentMethod: 'check', checkId: check.id } : {})
			})
			.wait({ tier })
		const counterpart =
			destination && destinationCategory
				? await db
						.insert(app.transactions, {
							...base,
							accountId: destination.id,
							categoryId: destinationCategory.id,
							kind: 'income',
							source: 'simplefin',
							externalId: 'imported-transfer-counterpart'
						})
						.wait({ tier })
				: null
		if (scenario === 'transfer' && destination && destinationCategory) {
			await db
				.insert(app.transactions, {
					...base,
					amountMinor: 101,
					accountId: destination.id,
					categoryId: destinationCategory.id,
					kind: 'income',
					source: 'manual'
				})
				.wait({ tier })
		}
		const tag = await db
			.insert(app.tags, {
				organizationId: organization.id,
				kind: isIncome ? 'income' : 'expense',
				name: 'Historical',
				categoryId: category.id
			})
			.wait({ tier })
		const link = await db
			.insert(app.transactionTags, {
				organizationId: organization.id,
				transactionId: saved.id,
				tagId: tag.id
			})
			.wait({ tier })
		await db.update(app.tags, link.tagId, { archivedAt: new Date() }).wait({ tier })
		if (scenario === 'archived')
			await db.update(app.accounts, account.id, { archivedAt: new Date() }).wait({ tier })
		if (scenario === 'viewer') {
			const [member] = await db.all(
				app.organizationMembers.where({
					organizationId: organization.id,
					userId: snapshot.account.id
				})
			)
			if (!member) throw new Error('Missing membership')
			await db.update(app.organizationMembers, member.id, { role: 'viewer' }).wait({ tier })
		}
		return {
			id: saved.id,
			counterpartId: counterpart?.id,
			accountId: account.id,
			destinationAccountId: destination?.id,
			categoryId: category.id,
			linkId: link.id,
			tagId: link.tagId
		}
	}, scenario)
}

export async function persisted(page: Page, id: string) {
	return page.evaluate(async (id) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const [row] = await db.all(app.transactions.where({ id }))
		const links = await db.all(app.transactionTags.where({ transactionId: id }))
		const transfers = await db.all(app.internalTransfers.where({ expenseTransactionId: id }))
		const check = row?.checkId
			? await db.one(app.checks.where({ id: row.checkId }), { tier: 'local-first' })
			: null
		return {
			accountId: row?.accountId,
			amountMinor: row?.amountMinor,
			internalTransferId: row?.internalTransferId,
			memo: row?.memo,
			description: row?.description,
			categoryId: row?.categoryId,
			source: row?.source,
			externalId: row?.externalId,
			paymentMethod: row?.paymentMethod,
			checkId: row?.checkId,
			links: links.map(({ id, tagId }) => ({ id, tagId })),
			transfers: transfers.map(({ expenseTransactionId, incomeTransactionId }) => ({
				expenseTransactionId,
				incomeTransactionId
			})),
			checkNumber: check?.checkNumber,
			checkAccountId: check?.accountId
		}
	}, id)
}
