import { expect, test, type Page } from '@playwright/test'
import { seedTransaction } from './helpers/transactions.js'

async function attachmentState(page: Page, transactionId: string) {
	return page.evaluate(async (transactionId) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		const links = await db.all(app.transactionAttachments.where({ transactionId }))
		return Promise.all(
			links.map(async ({ id, fileId }) => {
				const file = await db.one(app.files.where({ id: fileId }), { tier: 'local-first' })
				const parts = await db.all(app.fileParts.where({ fileId }).orderBy('partIndex'))
				return {
					id,
					fileId,
					fileName: file?.fileName,
					mimeType: file?.mimeType,
					parts: parts.length,
					bytes: parts.flatMap((part) => [...(part.data ?? [])])
				}
			})
		)
	}, transactionId)
}

async function findTransactionByDescription(page: Page, description: string) {
	return page.evaluate(async (description) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing database')
		return (await db.all(app.transactions.where({ description })))[0]?.id
	}, description)
}

const onePixelPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
	'base64'
)

test(
	'creates an image attachment, downloads it, and removes only its transaction link',
	{ tag: ['@transactions', '@transaction-edit', '@attachments'] },
	async ({ page }) => {
		const seed = await seedTransaction(page)
		await page.goto('/expenses/new')
		const main = page.getByRole('main')
		await expect(main.getByLabel('Amount', { exact: true })).toBeEnabled()
		await main.getByLabel('Account', { exact: true }).selectOption(seed.accountId)
		await main.getByLabel('Category', { exact: true }).selectOption(seed.categoryId)
		await main.getByLabel('Amount', { exact: true }).fill('12.34')
		await main.getByLabel('Description', { exact: true }).fill('Image receipt')
		await main.locator('input[type="file"]').setInputFiles({
			name: 'receipt.png',
			mimeType: 'image/png',
			buffer: onePixelPng
		})
		await expect
			.poll(() =>
				main
					.locator('input[type="file"]')
					.evaluate((input: HTMLInputElement) => input.files?.length)
			)
			.toBe(1)
		await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await page.waitForURL(/\/expenses(?:\?|$)/)
		await expect.poll(() => findTransactionByDescription(page, 'Image receipt')).toBeTruthy()
		const transactionId = await findTransactionByDescription(page, 'Image receipt')
		if (!transactionId) throw new Error('Saved transaction was not found')
		await page.goto(`/expenses/${transactionId}`)
		const information = page.getByRole('button', {
			name: 'Image details: receipt.png',
			exact: true
		})
		await information.focus()
		await information.press('Enter')
		const filename = page.getByRole('link', { name: 'receipt.png', exact: true })
		await expect(filename).toBeVisible()
		const preview = page.getByRole('dialog', { name: 'receipt.png', exact: true })
		await expect(preview.getByRole('img', { name: 'Preview of receipt.png' })).toBeVisible()
		const [download] = await Promise.all([page.waitForEvent('download'), filename.click()])
		expect(download.suggestedFilename()).toBe('receipt.png')
		const [attached] = await attachmentState(page, transactionId)
		expect(attached).toMatchObject({ fileName: 'receipt.png', mimeType: 'image/png' })
		expect(attached?.parts).toBeGreaterThan(0)
		const fileId = attached?.fileId
		if (!fileId || !attached) throw new Error('Uploaded file was not found')

		await page.keyboard.press('Escape')
		await expect(information).toBeFocused()
		await information.press('Enter')
		await page.getByRole('button', { name: 'Remove receipt.png', exact: true }).focus()
		await page.getByRole('button', { name: 'Remove receipt.png', exact: true }).press('Enter')
		await expect.poll(() => attachmentState(page, transactionId)).toHaveLength(0)
		if (!fileId || !attached) throw new Error('Uploaded file was not found')
		const retained = await page.evaluate(async (fileId) => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Missing database')
			return db.one(app.files.where({ id: fileId }), { tier: 'local-first' })
		}, fileId)
		// Unlinked contents are deliberately hidden by Finance's file policy.
		expect(retained).toBeNull()
		// Reattaching the original reference proves removal retained the same file
		// and bytes, without relying on a mismatched cross-transaction reference.
		const reattached = await page.evaluate(
			async ({ fileId, transactionId }) => {
				const schemaPath = '/src/lib/schema.ts',
					sessionPath = '/src/lib/runtime/jazz-session.ts'
				const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
				const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
					await import(sessionPath)
				const db = getCurrentJazzSession()?.getSnapshot().client?.db
				if (!db) throw new Error('Missing database')
				await db
					.insert(app.transactionAttachments, { transactionId, fileId })
					.wait({ tier: 'global' })
				const file = await db.one(app.files.where({ id: fileId }), { tier: 'remote' })
				const parts = await db.all(app.fileParts.where({ fileId }).orderBy('partIndex'), {
					tier: 'remote'
				})
				return { id: file?.id, bytes: parts.flatMap((part) => [...(part.data ?? [])]) }
			},
			{ fileId, transactionId }
		)
		expect(reattached.id).toBe(fileId)
		expect(reattached.bytes).toEqual(attached.bytes)
	}
)

test(
	'accumulates images beside the picker, removes a draft, and restores saved previews after reload',
	{ tag: ['@transactions', '@transaction-edit', '@attachments'] },
	async ({ page }) => {
		const seed = await seedTransaction(page)
		await page.goto(`/expenses/${seed.id}`)
		const imageInput = page.locator('main input[type="file"]')
		await expect(imageInput).toBeEnabled()
		await imageInput.setInputFiles({
			name: 'edited.png',
			mimeType: 'image/png',
			buffer: onePixelPng
		})
		await expect(imageInput).toHaveAttribute('multiple', '')
		await imageInput.setInputFiles({
			name: 'second.png',
			mimeType: 'image/png',
			buffer: onePixelPng
		})
		await expect(page.getByRole('img', { name: 'edited.png', exact: true })).toBeVisible()
		await expect(page.getByRole('img', { name: 'second.png', exact: true })).toBeVisible()
		const inputBounds = await imageInput.boundingBox()
		const firstBounds = await page
			.getByRole('img', { name: 'edited.png', exact: true })
			.boundingBox()
		if (!inputBounds || !firstBounds) throw new Error('Missing picker or preview')
		expect(firstBounds.x + firstBounds.width).toBeLessThanOrEqual(inputBounds.x)
		await page.getByRole('button', { name: 'Image details: second.png', exact: true }).click()
		await page.getByRole('button', { name: 'Remove Image: second.png', exact: true }).focus()
		await page.keyboard.press('Enter')
		await expect(imageInput).toBeFocused()
		await expect(page.getByRole('img', { name: 'second.png', exact: true })).toHaveCount(0)

		await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(page.getByRole('img', { name: 'Preview of edited.png' })).toBeVisible()
		await expect.poll(() => attachmentState(page, seed.id)).toHaveLength(1)
		await page.reload()
		await expect(page.getByRole('img', { name: 'Preview of edited.png' })).toBeVisible()
	}
)

test(
	'shows shared form feedback when selected images exceed the per-transaction limit',
	{ tag: ['@transactions', '@transaction-edit', '@attachments'] },
	async ({ page }) => {
		await seedTransaction(page)
		await page.goto('/expenses/new')
		const main = page.getByRole('main')
		await main.getByLabel('Amount', { exact: true }).fill('12.34')
		await expect(
			main.getByText(
				'JPEG, PNG, or WebP images. Up to five images per transaction. Up to 10 MiB per image.'
			)
		).toBeVisible()
		await main.locator('input[type="file"]').setInputFiles(
			Array.from({ length: 6 }, (_, index) => ({
				name: `receipt-${index}.png`,
				mimeType: 'image/png',
				buffer: onePixelPng
			}))
		)
		await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await expect(main.locator('#transaction-attachments-error')).toContainText(
			'Check the form and try again.'
		)
	}
)

test(
	'shows shared form feedback for unsupported and oversized image selections',
	{ tag: ['@transactions', '@transaction-edit', '@attachments'] },
	async ({ page }) => {
		await seedTransaction(page)
		const selections = [
			{
				name: 'receipt.svg',
				mimeType: 'image/svg+xml',
				buffer: Buffer.from('<svg></svg>')
			},
			{
				name: 'oversized.png',
				mimeType: 'image/png',
				buffer: Buffer.alloc(10 * 1024 * 1024 + 1)
			}
		]
		for (const selection of selections) {
			await page.goto('/expenses/new')
			const main = page.getByRole('main')
			await main.getByLabel('Amount', { exact: true }).fill('12.34')
			await main.locator('input[type="file"]').setInputFiles({
				name: selection.name,
				mimeType: selection.mimeType,
				buffer: selection.buffer
			})
			await main.getByRole('button', { name: 'Save Transaction', exact: true }).click()
			await expect(main.locator('#transaction-attachments-error')).toContainText(
				'Check the form and try again.'
			)
		}
	}
)
