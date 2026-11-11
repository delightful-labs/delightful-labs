import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function seed(page: Page) {
	await page.goto('/accounts')
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Add Account', exact: true })
	).toBeEnabled({ timeout: 30_000 })
	return page.evaluate(async () => {
		const schemaPath = '/src/lib/schema.ts',
			sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing session')
		const [org] = await db.all(app.organizations)
		if (!org) throw new Error('Missing workspace')
		const account = await db
			.insert(app.accounts, {
				organizationId: org.id,
				name: 'Editor ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'local' })
		const category = await db
			.insert(app.categories, {
				organizationId: org.id,
				name: 'Editor category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'local' })
		const transaction = await db
			.insert(app.transactions, {
				organizationId: org.id,
				accountId: account.id,
				categoryId: category.id,
				amountMinor: 100,
				currency: 'USD',
				kind: 'expense',
				bookedOn: '2026-10-28',
				source: 'manual'
			})
			.wait({ tier: 'local' })
		return { transactionId: transaction.id, accountId: account.id, categoryId: category.id }
	})
}
async function receipt(page: Page) {
	const bytes = await page.evaluate(async () => {
		const canvas = document.createElement('canvas')
		canvas.width = 80
		canvas.height = 60
		const context = canvas.getContext('2d')
		if (!context) throw new Error('No canvas')
		context.fillStyle = 'rgb(64, 128, 192)'
		context.fillRect(0, 0, 80, 60)
		const blob = await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(value) => (value ? resolve(value) : reject(new Error('No fixture image'))),
				'image/png'
			)
		)
		return [...new Uint8Array(await blob.arrayBuffer())]
	})
	return { name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from(bytes) }
}
async function decode(bytes: number[]) {
	const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
	try {
		const canvas = document.createElement('canvas')
		canvas.width = bitmap.width
		canvas.height = bitmap.height
		const context = canvas.getContext('2d')
		if (!context) throw new Error('No decoder canvas')
		context.drawImage(bitmap, 0, 0)
		return {
			width: bitmap.width,
			height: bitmap.height,
			pixel: [...context.getImageData(0, 0, 1, 1).data]
		}
	} finally {
		bitmap.close()
	}
}
async function images(page: Page, transactionId: string) {
	return page.evaluate(async (transactionId) => {
		const schemaPath = '/src/lib/schema.ts',
			sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const db = getCurrentJazzSession()?.getSnapshot().client?.db
		if (!db) throw new Error('Missing session')
		const links = await db.all(
			app.transactionAttachments.where({ transactionId }).include({ file: { parts: true } }),
			{ tier: 'local-first' }
		)
		return links.map((link) => ({
			id: link.id,
			fileId: link.fileId,
			name: link.file?.fileName,
			type: link.file?.mimeType,
			bytes: [...(link.file?.parts ?? [])]
				.sort((a, b) => a.partIndex - b.partIndex)
				.flatMap(({ data }) => [...(data ?? [])])
		}))
	}, transactionId)
}
async function information(page: Page) {
	const button = page.getByRole('button', { name: 'Image details: receipt.png', exact: true })
	await button.focus()
	await button.press('Enter')
	const dialog = page.getByRole('dialog', { name: 'receipt.png', exact: true })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole('img')).toBeVisible()
	await expect(dialog.getByRole('heading', { name: 'receipt.png', exact: true })).toBeVisible()
	return dialog
}
async function editor(page: Page) {
	const preview = await information(page)
	await preview.getByRole('button', { name: 'Edit Image', exact: true }).click()
	await expect(preview).toBeHidden()
	const dialog = page.getByRole('dialog', { name: 'Edit Image', exact: true })
	await expect(dialog.getByRole('button', { name: 'Apply changes', exact: true })).toBeEnabled()
	return dialog
}
async function uploadSaved(page: Page, id: string) {
	await page.goto(`/expenses/${id}`)
	const input = page.getByLabel('Add Images', { exact: true })
	await expect(input).toBeEnabled()
	await input.setInputFiles(await receipt(page))
	await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
	await expect(page.getByRole('img', { name: 'Preview of receipt.png', exact: true })).toBeVisible()
}

test(
	'edits a new selection with keyboard crop handles, grayscale and contrast, then saves the edited bytes',
	{ tag: ['@transactions', '@attachments'] },
	async ({ page }) => {
		const ledger = await seed(page)
		await page.goto('/expenses/new')
		await page.getByLabel('Account', { exact: true }).selectOption(ledger.accountId)
		await page.getByLabel('Category', { exact: true }).selectOption(ledger.categoryId)
		await page.getByLabel('Amount', { exact: true }).fill('12.34')
		await page.getByLabel('Description', { exact: true }).fill('Editor draft receipt')
		const input = page.getByLabel('Add Images', { exact: true })
		await expect(input).toBeEnabled()
		await input.setInputFiles(await receipt(page))
		const dialog = await editor(page)
		await dialog.getByLabel('Crop shape', { exact: true }).selectOption('rectangle')
		const corner = dialog.getByRole('button', {
			name: 'Resize crop from top left corner',
			exact: true
		})
		await corner.focus()
		await corner.press('Shift+ArrowRight')
		await corner.press('Shift+ArrowDown')
		await dialog.getByLabel('Black and white', { exact: true }).check()
		await dialog.getByRole('button', { name: 'Contrast', exact: true }).click()
		const slider = dialog.getByRole('slider', { name: 'Contrast', exact: true })
		await slider.focus()
		await slider.press('End')
		await expect(slider).toHaveValue('200')
		await slider.press('Escape')
		await expect(dialog).toBeVisible()
		await dialog.getByRole('button', { name: 'Preview Image', exact: true }).click()
		await expect(dialog.getByRole('button', { name: 'Edit Image', exact: true })).toBeVisible()
		const preview = await dialog.locator('canvas').evaluate((canvas) => {
			if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing preview')
			return {
				width: canvas.width,
				height: canvas.height,
				pixel: [...(canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data ?? [])]
			}
		})
		expect(preview.width).toBeLessThan(80)
		expect(preview.height).toBeLessThan(60)
		expect(preview.pixel).toEqual([111, 111, 111, 255])
		await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()
		await expect(dialog).toBeHidden()
		await page.getByRole('button', { name: 'Save Transaction', exact: true }).click()
		await page.waitForURL(/\/expenses(?:\?|$)/)
		const id = await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts',
				sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const row = await getCurrentJazzSession()
				?.getSnapshot()
				.client?.db.one(app.transactions.where({ description: 'Editor draft receipt' }), {
					tier: 'local-first'
				})
			return row?.id
		})
		if (!id) throw new Error('Edited transaction was not saved')
		await expect.poll(async () => (await images(page, id)).length).toBe(1)
		const [image] = await images(page, id)
		if (!image) throw new Error('Missing saved image')
		expect(image.name).toBe('receipt.png')
		expect(image.type).toBe('image/png')
		expect(await page.evaluate(decode, image.bytes)).toEqual(preview)
	}
)

test(
	'cancels saved perspective edits, then applies grayscale offline with stable identity and downloadable bytes after reload',
	{ tag: ['@transactions', '@attachments'] },
	async ({ page }) => {
		const ledger = await seed(page)
		await uploadSaved(page, ledger.transactionId)
		const [original] = await images(page, ledger.transactionId)
		if (!original) throw new Error('Missing original attachment')
		let dialog = await editor(page)
		const left = dialog.getByRole('button', {
			name: 'Resize crop from top left corner',
			exact: true
		})
		const right = dialog.getByRole('button', {
			name: 'Resize crop from top right corner',
			exact: true
		})
		const rightBefore = await right.boundingBox(),
			leftBefore = await left.boundingBox()
		await left.focus()
		await left.press('Shift+ArrowRight')
		const rightAfter = await right.boundingBox(),
			leftAfter = await left.boundingBox()
		if (!rightBefore || !rightAfter || !leftBefore || !leftAfter)
			throw new Error('Missing corner bounds')
		expect(leftAfter.x).toBeGreaterThan(leftBefore.x)
		expect(rightAfter.x).toBeCloseTo(rightBefore.x, 1)
		await left.press('Escape')
		await expect(dialog).toBeHidden()
		expect(await images(page, ledger.transactionId)).toEqual([original])
		await page.context().setOffline(true)
		try {
			dialog = await editor(page)
			await dialog.getByLabel('Black and white', { exact: true }).check()
			await dialog.getByRole('button', { name: 'Contrast', exact: true }).click()
			const slider = dialog.getByRole('slider', { name: 'Contrast', exact: true })
			await slider.focus()
			await slider.press('Home')
			await slider.press('Escape')
			await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click()
			await expect(dialog).toBeHidden()
			await expect
				.poll(async () => (await images(page, ledger.transactionId))[0]?.fileId)
				.not.toBe(original.fileId)
		} finally {
			await page.context().setOffline(false)
		}
		await page.reload()
		await expect(
			page.getByRole('img', { name: 'Preview of receipt.png', exact: true })
		).toBeVisible()
		const [current] = await images(page, ledger.transactionId)
		if (!current) throw new Error('Missing edited attachment')
		expect(current.id).toBe(original.id)
		expect(current.fileId).not.toBe(original.fileId)
		expect(await page.evaluate(decode, current.bytes)).toEqual({
			width: 80,
			height: 60,
			pixel: [128, 128, 128, 255]
		})
		await information(page)
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('link', { name: 'receipt.png', exact: true }).click()
		])
		expect(download.suggestedFilename()).toBe('receipt.png')
		const path = await download.path()
		if (!path) throw new Error('Missing downloaded file')
		expect(await page.evaluate(decode, [...(await readFile(path))])).toEqual({
			width: 80,
			height: 60,
			pixel: [128, 128, 128, 255]
		})
	}
)

test(
	'viewers can preview and download saved images but cannot edit or delete',
	{ tag: ['@transactions', '@attachments', '@permissions'] },
	async ({ page }) => {
		const ledger = await seed(page)
		await uploadSaved(page, ledger.transactionId)
		await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts',
				sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const snapshot = getCurrentJazzSession()?.getSnapshot()
			if (!snapshot?.client || !snapshot.account) throw new Error('Missing session')
			const [membership] = await snapshot.client.db.all(
				app.organizationMembers.where({ userId: snapshot.account.id })
			)
			if (!membership) throw new Error('Missing membership')
			await snapshot.client.db
				.update(app.organizationMembers, membership.id, { role: 'viewer' })
				.wait({ tier: 'local' })
		})
		await expect(page.getByLabel('Add Images', { exact: true })).toBeDisabled()
		const dialog = await information(page)
		await expect(dialog.getByRole('link', { name: 'receipt.png', exact: true })).toBeVisible()
		await expect(page.getByRole('button', { name: 'Edit Image', exact: true })).toHaveCount(0)
		await expect(
			dialog.getByRole('button', { name: 'Remove receipt.png', exact: true })
		).toHaveCount(0)
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			dialog.getByRole('link', { name: 'receipt.png', exact: true }).click()
		])
		expect(download.suggestedFilename()).toBe('receipt.png')
		await page.keyboard.press('Escape')
		await expect(dialog).toBeHidden()
		await expect(
			page.getByRole('button', { name: 'Image details: receipt.png', exact: true })
		).toBeFocused()
	}
)
