import {
	prepareSidebar,
	openCreationModal,
	closeCreationModal,
	navigateSidebar
} from './helpers/ui.js'
import { expect, test, type Page } from '@playwright/test'
import { RecoveryPhrase } from 'jazz-tools/passphrase'
import { generateAuthSecret } from 'jazz-tools'

// These scenarios reveal or enter real disposable credentials. Playwright 1.64 also honors
// this flag when collecting failure-page ARIA snapshots; trace/screenshot settings alone do not.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

async function createAccount(page: Page, name: string) {
	await page.goto('/accounts')
	await prepareSidebar(page)
	await expect(page.getByLabel('Current Workspace', { exact: true })).not.toHaveValue('')
	const dialog = await openCreationModal(page, 'Add Account')
	await dialog.getByLabel('Account name').fill(name)
	await dialog.getByLabel('Account type').selectOption('bank')
	await dialog.getByRole('button', { name: 'Add Account', exact: true }).click()
	await expect(dialog.getByRole('status')).toContainText(name)
	await closeCreationModal(page)
}

async function restoreAccount(page: Page, phrase: string) {
	const previousWorkspace = new URL(page.url()).searchParams.get('workspace')
	await page.goto(previousWorkspace ? `/login?workspace=${previousWorkspace}` : '/login')
	await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	await expect(page).toHaveURL((url) => url.pathname === '/')
	await prepareSidebar(page)
}

// Return only a boolean so failed cleanup cannot print a still-populated credential field.
async function expectEmptyRecoveryDraft(page: Page) {
	await expect
		.poll(
			async () =>
				(await page.getByLabel('Recovery phrase', { exact: true }).inputValue()).length === 0
		)
		.toBe(true)
}

const invalidPhrases = [
	{ name: 'wrong word count', phrase: 'abandon' },
	{ name: 'unknown word', phrase: Array(24).fill('notaword').join(' ') },
	{ name: 'invalid checksum', phrase: Array(24).fill('abandon').join(' ') }
]

test(
	'rejects invalid recovery phrases without replacing the current account or data',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await createAccount(page, 'Retained checking')
		const workspaceId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		await page.goto(`/login?workspace=${workspaceId}`)
		for (const { name, phrase } of invalidPhrases) {
			await test.step(name, async () => {
				expect(() => RecoveryPhrase.toSecret(phrase)).toThrow()
				await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
				await page.getByRole('button', { name: 'Login', exact: true }).click()
				await expect(
					page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })
				).toHaveText('The account could not be restored. Check the recovery phrase and try again.')
				await expect(page).toHaveURL(`/login?workspace=${workspaceId}`)
				await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled()
				await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveValue(phrase)
				await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
			})
		}

		await page.goto(`/accounts?workspace=${workspaceId}`)
		await page.reload()
		await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
		await expect(
			page.getByLabel('Current Workspace', { exact: true }).locator('option:not([value=""])')
		).toHaveCount(1)
		await expect(page.getByRole('cell', { name: 'Retained checking', exact: true })).toHaveCount(1)
	}
)

test(
	'restores existing workspace data without duplicates or previous identity accounts',
	{ tag: ['@identity', '@workspaces'] },
	async ({ page, browser, baseURL }) => {
		await createAccount(page, 'Original checking')
		const workspaceId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		await page.goto('/account')
		await page.getByRole('button', { name: 'Show Recovery phrase' }).click()
		const phrase = await page.getByLabel('Your recovery phrase').inputValue()
		await page.getByRole('button', { name: 'Close', exact: true }).click()

		const otherContext = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
		try {
			const otherPage = await otherContext.newPage()
			await createAccount(otherPage, 'Previous identity checking')
			await restoreAccount(otherPage, phrase)
			await expect(otherPage).toHaveURL(`/?workspace=${workspaceId}`)
			await expect(otherPage.getByLabel('Current Workspace', { exact: true })).toHaveValue(
				workspaceId
			)
			await otherPage.goto(`/accounts?workspace=${workspaceId}`)
			await expect(otherPage.getByLabel('Current Workspace', { exact: true })).toHaveValue(
				workspaceId
			)
			await expect(
				otherPage.getByLabel('Current Workspace', { exact: true }).locator('option:not([value=""])')
			).toHaveCount(1)
			await otherPage.goto(`/accounts?workspace=${workspaceId}`)
			await expect(
				otherPage.getByRole('cell', { name: 'Original checking', exact: true })
			).toBeVisible()
			await expect(otherPage.getByText('Previous identity checking', { exact: true })).toHaveCount(
				0
			)

			await restoreAccount(otherPage, phrase)
			await otherPage.goto(`/accounts?workspace=${workspaceId}`)
			await otherPage.reload()
			await expect(otherPage.getByLabel('Current Workspace', { exact: true })).toHaveValue(
				workspaceId
			)
			await expect(
				otherPage.getByLabel('Current Workspace', { exact: true }).locator('option:not([value=""])')
			).toHaveCount(1)
			await otherPage.goto(`/accounts?workspace=${workspaceId}`)
			await expect(
				otherPage.getByRole('cell', { name: 'Original checking', exact: true })
			).toHaveCount(1)
			await expect(otherPage.getByText('Previous identity checking', { exact: true })).toHaveCount(
				0
			)
			await otherPage.goto(`/expenses/new?workspace=${workspaceId}`)
			await expect(otherPage.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(
				6
			)
			await otherPage.goto(`/income/new?workspace=${workspaceId}`)
			await expect(otherPage.getByLabel('Category', { exact: true }).locator('option')).toHaveCount(
				4
			)
		} finally {
			await otherContext.close()
		}
	}
)

test(
	'recovery clears on route unmount and remounts on the same host identity',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await createAccount(page, 'Recovery unmount checking')
		await page.goto('/account')
		await expect.poll(() => currentIdentity(page)).toBeTruthy()
		const identity = await currentIdentity(page)
		await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
		const phrase = page.getByLabel('Your recovery phrase', { exact: true })
		await expect(phrase).toBeVisible()
		// Trigger the existing host navigation while the modal makes the sidebar inert.
		await page
			.locator('aside')
			.getByRole('link', {
				name: 'Manage Accounts',
				exact: true,
				includeHidden: true
			})
			.evaluate((element: HTMLAnchorElement) => element.click())
		await expect(page).toHaveURL((url) => url.pathname === '/accounts')
		await expect(phrase).toHaveCount(0)
		expect(await currentIdentity(page)).toBe(identity)
		await navigateSidebar(page, 'Account')
		await expect(phrase).toHaveCount(0)
		await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
		expect(await phrase.evaluate((element: HTMLTextAreaElement) => element.value.length > 0)).toBe(
			true
		)
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		expect(await currentIdentity(page)).toBe(identity)
	}
)

test(
	'recovery invalidates a revealed phrase when the host replaces the account',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await createAccount(page, 'Recovery replacement checking')
		await page.goto('/account')
		await expect.poll(() => currentIdentity(page)).toBeTruthy()
		const identity = await currentIdentity(page)
		await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
		const phrase = page.getByLabel('Your recovery phrase', { exact: true })
		await expect(phrase).toBeVisible()
		// One public SDK operation on Finance's existing session, not a new provider/client.
		await page.evaluate(async () => {
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const {
				getCurrentJazzSession,
				loadLocalFirstClient
			}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
			const session = getCurrentJazzSession()
			if (!session) throw new Error('Test session is not ready')
			await session.createLocalFirst()
		})
		await expect(phrase).toHaveCount(0)
		await expect.poll(() => currentIdentity(page)).not.toBe(identity)
		const show = page.getByRole('button', { name: 'Show Recovery phrase', exact: true })
		await expect(show).toBeEnabled()
		await show.click()
		expect(await phrase.evaluate((element: HTMLTextAreaElement) => element.value.length > 0)).toBe(
			true
		)
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(phrase).toHaveCount(0)
	}
)

async function saveDisplayName(page: Page, name: string) {
	await page.goto('/account')
	await expect(page.getByLabel('Display name', { exact: true })).toBeEnabled()
	await page.getByLabel('Display name', { exact: true }).fill(name)
	await page.getByRole('button', { name: 'Save', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('status').filter({ hasText: 'Profile Display name saved.' })
	).toHaveCount(1)
}

test(
	'profile name trims, survives reload, and can be cleared',
	{ tag: ['@workflow-completion', '@identity'] },
	async ({ page }) => {
		await saveDisplayName(page, '  Profile owner  ')
		await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Profile owner')
		await page.reload()
		await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Profile owner')
		await page.getByLabel('Display name', { exact: true }).fill('  ')
		await page.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('status').filter({ hasText: 'Profile Display name saved.' })
		).toHaveCount(1)
		await page.reload()
		await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('')
	}
)

test(
	'profile name follows the recovered identity across devices',
	{ tag: ['@identity'] },
	async ({ page, browser, baseURL }) => {
		await saveDisplayName(page, 'Recovered owner')
		// Confirm synchronization without including recovery secrets in output.
		await expect
			.poll(() =>
				page.evaluate(async () => {
					const schemaPath = '/src/lib/schema.ts'
					const sessionPath = '/src/lib/runtime/jazz-session.ts'
					const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
					const {
						getCurrentJazzSession,
						loadLocalFirstClient
					}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
					const snapshot = getCurrentJazzSession()?.getSnapshot()
					if (!snapshot?.client || !snapshot.account) throw new Error('Session not ready')
					return (
						await snapshot.client.db.one(app.profiles.where({ userId: snapshot.account.id }), {
							tier: 'remote'
						})
					)?.displayName
				})
			)
			.toBe('Recovered owner')
		await page.getByRole('button', { name: 'Show Recovery phrase' }).click()
		const phrase = await page.getByLabel('Your recovery phrase').inputValue()
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
		try {
			const other = await context.newPage()
			await saveDisplayName(other, 'Previous identity')
			await restoreAccount(other, phrase)
			await other.goto('/account')
			await expect(other.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
			await other.reload()
			await expect(other.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
			await page.reload()
			await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Recovered owner')
		} finally {
			await context.close()
		}
	}
)

async function avatarRecord(page: Page, remote = false) {
	return page.evaluate(async (remote) => {
		const schemaPath = '/src/lib/schema.ts'
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
		const {
			getCurrentJazzSession,
			loadLocalFirstClient
		}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
		const snapshot = getCurrentJazzSession()?.getSnapshot()
		if (!snapshot?.client || !snapshot.account) throw new Error('Session not ready')
		const profile = await snapshot.client.db.one(
			app.profiles.where({ userId: snapshot.account.id }),
			remote ? { tier: 'remote' } : {}
		)
		if (!profile) throw new Error('Profile not ready')
		const bytes = profile.avatarData
		return {
			id: profile.id,
			userId: profile.userId,
			displayName: profile.displayName ?? null,
			mimeType: profile.avatarMimeType ?? null,
			byteLength: bytes?.byteLength ?? 0,
			checksum: bytes
				? Array.from(
						new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
					).join(',')
				: null
		}
	}, remote)
}

async function avatarImage(page: Page, width: number, height: number, noisy = false) {
	const bytes = await page.evaluate(
		async ({ width, height, noisy }) => {
			const canvas = new OffscreenCanvas(width, height)
			const context = canvas.getContext('2d')
			if (!context) throw new Error('Canvas unavailable')
			if (noisy) {
				const image = context.createImageData(width, height)
				for (let offset = 0; offset < image.data.length; offset += 65536)
					crypto.getRandomValues(image.data.subarray(offset, offset + 65536))
				for (let index = 3; index < image.data.length; index += 4) image.data[index] = 255
				context.putImageData(image, 0, 0)
			} else {
				context.fillStyle = '#318060'
				context.fillRect(0, 0, width, height)
			}
			const blob = await canvas.convertToBlob({ type: 'image/png' })
			return Array.from(new Uint8Array(await blob.arrayBuffer()))
		},
		{ width, height, noisy }
	)
	return { name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from(bytes) }
}

function avatarPreview(page: Page) {
	return page
		.getByRole('group')
		.filter({ has: page.getByLabel('Avatar', { exact: true }) })
		.locator('img')
}

async function waitForAvatar(page: Page, width: number, height: number) {
	const image = avatarPreview(page)
	await expect(image).toBeVisible()
	const input = page.getByLabel('Avatar', { exact: true })
	await expect(input).not.toHaveAttribute('multiple')
	expect(
		await page.getByRole('button', { name: 'Avatar details: avatar', exact: true }).boundingBox()
	).toEqual(await image.boundingBox())
	await expect
		.poll(() =>
			image.evaluate((element: HTMLImageElement) => [element.naturalWidth, element.naturalHeight])
		)
		.toEqual([width, height])
	return image
}

async function uploadAvatar(
	page: Page,
	image: Awaited<ReturnType<typeof avatarImage>>,
	replace = false
) {
	const input = page.getByLabel('Avatar', { exact: true })
	await expect(input).toBeEnabled()
	if (replace) {
		await page.getByRole('button', { name: 'Avatar details: avatar', exact: true }).click()
		await expect(page.getByRole('dialog', { name: 'avatar', exact: true })).toBeVisible()
	}
	await input.setInputFiles(image)
	const cropDialog = page.getByRole('dialog', { name: 'Crop your avatar', exact: true })
	await expect(cropDialog).toBeVisible()
	await cropDialog.getByRole('button', { name: 'Use this crop', exact: true }).click()
	await expect(cropDialog).not.toBeVisible()
	await page.getByRole('button', { name: 'Save Avatar', exact: true }).click()
	await expect(
		page.getByRole('main').getByRole('status').filter({ hasText: 'Avatar saved.' })
	).toHaveCount(1)
}

test(
	'avatar upload above 256 KB resizes, replaces, removes, and persists without changing the name',
	{ tag: ['@workflow-completion', '@identity'] },
	async ({ page }) => {
		test.setTimeout(120_000)
		await page.addInitScript(() => {
			const revoke = URL.revokeObjectURL.bind(URL)
			window.avatarRevokedUrls = []
			URL.revokeObjectURL = (url) => {
				window.avatarRevokedUrls.push(url)
				revoke(url)
			}
		})
		await saveDisplayName(page, 'Avatar owner')
		const large = await avatarImage(page, 512, 256, true)
		expect(large.buffer.byteLength).toBeGreaterThan(256 * 1024)
		await uploadAvatar(page, large)
		const firstImage = await waitForAvatar(page, 256, 256)
		const firstUrl = await firstImage.getAttribute('src')
		const first = await avatarRecord(page)
		expect(first.mimeType).toBe('image/webp')
		expect(first.byteLength).toBeGreaterThan(0)
		expect(first.byteLength).toBeLessThanOrEqual(256 * 1024)
		expect(first.displayName).toBe('Avatar owner')
		await page.reload()
		await waitForAvatar(page, 256, 256)
		expect(await avatarRecord(page)).toEqual(first)
		const reloadedUrl = await avatarPreview(page).getAttribute('src')
		await uploadAvatar(page, await avatarImage(page, 120, 240), true)
		await waitForAvatar(page, 120, 120)
		await expect
			.poll(() =>
				page.evaluate((url) => url !== null && window.avatarRevokedUrls.includes(url), reloadedUrl)
			)
			.toBe(true)
		const replacement = await avatarRecord(page)
		expect(replacement.checksum).not.toBe(first.checksum)
		expect(replacement.id).toBe(first.id)
		expect(replacement.displayName).toBe(first.displayName)
		const replacementUrl = await avatarPreview(page).getAttribute('src')
		await page.getByRole('button', { name: 'Avatar details: avatar', exact: true }).click()
		await page.getByRole('button', { name: 'Remove Avatar', exact: true }).focus()
		await page.getByRole('button', { name: 'Remove Avatar', exact: true }).press('Enter')
		await expect(avatarPreview(page)).toHaveCount(0)
		await expect
			.poll(() =>
				page.evaluate(
					(url) => url !== null && window.avatarRevokedUrls.includes(url),
					replacementUrl
				)
			)
			.toBe(true)
		await page.reload()
		await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
		await expect(page.getByRole('button', { name: 'Save Avatar', exact: true })).toHaveCount(0)
		const removed = await avatarRecord(page)
		expect(removed).toEqual({ ...first, byteLength: 0, mimeType: null, checksum: null })
		expect(firstUrl).toMatch(/^blob:/)
	}
)

test(
	'avatar preview opens its existing editor, cancels without saving, and applies a new crop',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await page.goto('/account')
		await uploadAvatar(page, await avatarImage(page, 100, 100))
		await waitForAvatar(page, 100, 100)
		const original = await avatarRecord(page)
		const trigger = page.getByRole('button', { name: 'Avatar details: avatar', exact: true })
		await trigger.focus()
		await trigger.press('Enter')
		const preview = page.getByRole('dialog', { name: 'avatar', exact: true })
		await expect(preview.getByRole('img', { name: 'avatar', exact: true })).toBeVisible()
		await preview.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(trigger).toBeFocused()
		await trigger.press('Space')
		await preview.getByRole('button', { name: 'Edit Avatar', exact: true }).click()
		await expect(preview).toBeHidden()
		const crop = page.getByRole('dialog', { name: 'Crop your avatar', exact: true })
		await expect(crop).toBeVisible()
		await crop.getByRole('button', { name: 'Cancel', exact: true }).click()
		await expect(crop).toBeHidden()
		expect(await avatarRecord(page)).toEqual(original)
		await expect(page.getByRole('button', { name: 'Save Avatar', exact: true })).toHaveCount(0)
		await trigger.click()
		await preview.getByRole('button', { name: 'Edit Avatar', exact: true }).click()
		await crop.getByRole('button', { name: 'Use this crop', exact: true }).click()
		await expect(crop).toBeHidden()
		await page.getByRole('button', { name: 'Save Avatar', exact: true }).click()
		await expect(
			page.getByRole('main').getByRole('status').filter({ hasText: 'Avatar saved.' })
		).toHaveCount(1)
		await page.reload()
		await waitForAvatar(page, 100, 100)
		expect((await avatarRecord(page)).byteLength).toBeGreaterThan(0)
	}
)

test(
	'avatar rejects invalid, oversized, and undecodable images and allows retry',
	{ tag: ['@workflow-completion', '@identity'] },
	async ({ page }) => {
		test.setTimeout(120_000)
		await page.goto('/account')
		await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
		await expect(
			page.getByText(
				'JPEG, PNG, or WebP images. Up to 10 MiB per image. Images are resized for your avatar.'
			)
		).toBeVisible()
		const initial = await avatarRecord(page)
		for (const file of [
			{ name: 'avatar.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
			{ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
			{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }
		]) {
			await page.getByLabel('Avatar', { exact: true }).setInputFiles(file)
			if (file.name === 'broken.png') {
				const cropDialog = page.getByRole('dialog', { name: 'Crop your avatar', exact: true })
				await expect(cropDialog.getByRole('alert')).toHaveText(
					'This image could not be cropped. Choose another image and try again.'
				)
				await cropDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
			} else {
				await expect(
					page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })
				).toHaveText('Check the form and try again.')
			}
			expect(await avatarRecord(page)).toEqual(initial)
		}
		await uploadAvatar(page, await avatarImage(page, 80, 40))
		await waitForAvatar(page, 40, 40)
		await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0)
	}
)

test(
	'avatar can upload, replace, and remove while offline',
	{ tag: ['@workflow-completion', '@identity'] },
	async ({ page }) => {
		test.setTimeout(120_000)
		await page.goto('/account')
		await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
		const first = await avatarImage(page, 400, 200)
		const second = await avatarImage(page, 100, 100)
		await page.context().setOffline(true)
		try {
			await uploadAvatar(page, first)
			await waitForAvatar(page, 200, 200)
			await uploadAvatar(page, second, true)
			await waitForAvatar(page, 100, 100)
			const local = await avatarRecord(page)
			expect(local.byteLength).toBeGreaterThan(0)
			await page.getByRole('button', { name: 'Avatar details: avatar', exact: true }).click()
			await page.getByRole('button', { name: 'Remove Avatar', exact: true }).focus()
			await page.getByRole('button', { name: 'Remove Avatar', exact: true }).press('Enter')
			await expect(avatarPreview(page)).toHaveCount(0)
			expect((await avatarRecord(page)).byteLength).toBe(0)
		} finally {
			await page.context().setOffline(false)
		}
		// A reconnect can initially return no remote profile. Retry the read as well as
		// the assertion; expect.poll stops immediately if avatarRecord throws.
		await expect(async () => {
			expect((await avatarRecord(page, true)).byteLength).toBe(0)
		}).toPass({ timeout: 15_000 })
		await page.reload()
		await expect(page.getByLabel('Avatar', { exact: true })).toBeEnabled()
		await expect(page.getByRole('button', { name: 'Save Avatar', exact: true })).toHaveCount(0)
	}
)

test(
	'avatar follows account recovery on another device',
	{ tag: ['@identity'] },
	async ({ page, browser, baseURL }) => {
		test.setTimeout(120_000)
		await saveDisplayName(page, 'Recovered avatar owner')
		await uploadAvatar(page, await avatarImage(page, 300, 600))
		await waitForAvatar(page, 256, 256)
		const original = await avatarRecord(page)
		await expect(async () => {
			expect(await avatarRecord(page, true)).toEqual(original)
		}).toPass({ timeout: 15_000 })
		await page.getByRole('button', { name: 'Show Recovery phrase' }).click()
		const phrase = await page.getByLabel('Your recovery phrase').inputValue()
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		const context = await browser.newContext({ baseURL: baseURL ?? 'http://127.0.0.1:5173' })
		try {
			const other = await context.newPage()
			await restoreAccount(other, phrase)
			await other.goto('/account')
			await waitForAvatar(other, 256, 256)
			await expect(other.getByLabel('Display name', { exact: true })).toHaveValue(
				'Recovered avatar owner'
			)
			expect(await avatarRecord(other)).toEqual(original)
			await other.reload()
			await waitForAvatar(other, 256, 256)
		} finally {
			await context.close()
		}
	}
)

declare global {
	interface Window {
		avatarRevokedUrls: string[]
	}
}

declare global {
	interface Window {
		authFailureTest: {
			shutdownAttempts: number
			storageFailures: number
			releaseSharedClient?: () => Promise<void>
			abortShutdown?: () => void
		}
	}
}

async function currentIdentity(page: Page) {
	return page.evaluate(async () => {
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const {
			getCurrentJazzSession,
			loadLocalFirstClient
		}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
		return getCurrentJazzSession()?.getSnapshot().account?.id
	})
}

test(
	'startup network failures can retry repeatedly without replacing the saved identity',
	{ tag: ['@identity'] },
	async ({ page, context }) => {
		await createAccount(page, 'Network retained checking')
		const identity = await currentIdentity(page)
		expect(identity).toBeTruthy()
		let blocked = 0
		let failing = true
		await context.route(/\.wasm(?:\?|$)/, async (route) => {
			if (failing) {
				blocked += 1
				await route.abort('internetdisconnected')
			} else await route.continue()
		})
		await page.reload()
		const retry = page.getByRole('button', { name: 'Try again', exact: true })
		await expect(retry).toBeVisible()
		await expect(page.getByRole('alert')).toHaveText('Your finances could not be opened.')
		expect(blocked).toBeGreaterThan(0)
		await retry.click()
		await expect(retry).toBeVisible()
		failing = false
		await retry.click()
		await expect(
			page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
		).toBeVisible()
		expect(await currentIdentity(page)).toBe(identity)
		await page.goto('/accounts')
		await expect(
			page.getByRole('cell', { name: 'Network retained checking', exact: true })
		).toBeVisible()
	}
)

test(
	'restore session failures retain identity and retry without exposing the recovery phrase',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await createAccount(page, 'Session retained checking')
		const identity = await currentIdentity(page)
		await page.goto('/account')
		await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
		const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		const messages: string[] = []
		const urls: string[] = []
		page.on('console', (message) => messages.push(message.text()))
		page.on('pageerror', (error) => messages.push(error.message))
		page.on('request', (request) => urls.push(request.url()))
		await page.goto('/login')
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.evaluate(async () => {
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const {
				getCurrentJazzSession,
				loadLocalFirstClient
			}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
			const client = getCurrentJazzSession()?.getSnapshot().client
			if (!client) throw new Error('Test session is not ready.')
			window.authFailureTest = { shutdownAttempts: 0, storageFailures: 0 }
			const shutdown = client.shutdown.bind(client)
			client.shutdown = async (options) => {
				window.authFailureTest.shutdownAttempts += 1
				if (window.authFailureTest.shutdownAttempts <= 2)
					throw new Error('Private simulated shutdown failure')
				return shutdown(options)
			}
		})
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		const retry = page.getByRole('button', { name: 'Try again', exact: true })
		await expect(retry).toBeVisible()
		await expect(page.getByRole('alert')).toHaveText('Your finances could not be opened.')
		expect(await currentIdentity(page)).toBe(identity)
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveCount(0)
		await retry.click()
		await expect.poll(() => page.evaluate(() => window.authFailureTest.shutdownAttempts)).toBe(2)
		await expect(retry).toBeVisible()
		await retry.click()
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
		expect(await currentIdentity(page)).toBe(identity)
		await expectEmptyRecoveryDraft(page)
		await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0)
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		await expect(page).toHaveURL((url) => url.pathname === '/')
		expect(await currentIdentity(page)).toBe(identity)
		await page.goto('/accounts')
		await expect(
			page.getByRole('cell', { name: 'Session retained checking', exact: true })
		).toBeVisible()
		for (const value of [...messages, ...urls]) {
			expect(value.includes(phrase), 'Recovery phrase must not appear in diagnostics or URLs').toBe(
				false
			)
			expect(
				value.includes(encodeURIComponent(phrase)),
				'Encoded phrase must not appear in URLs'
			).toBe(false)
			expect(
				value.includes('Private simulated shutdown failure'),
				'Raw SDK failures must not be rendered or logged'
			).toBe(false)
		}
	}
)

test(
	'session retry completes a selected identity after local selection storage fails',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await createAccount(page, 'Previous selection checking')
		const previous = await currentIdentity(page)
		const phrase = RecoveryPhrase.fromSecret(generateAuthSecret())
		await page.goto('/login')
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.evaluate(() => {
			window.authFailureTest = { shutdownAttempts: 0, storageFailures: 0 }
			const setItem = Storage.prototype.setItem
			Storage.prototype.setItem = function (key, value) {
				if (key.startsWith('jazz-account-selection-v1:')) {
					Storage.prototype.setItem = setItem
					window.authFailureTest.storageFailures += 1
					throw new DOMException('Simulated local selection failure', 'QuotaExceededError')
				}
				return setItem.call(this, key, value)
			}
		})
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		const retry = page.getByRole('button', { name: 'Try again', exact: true })
		await expect(retry).toBeVisible()
		expect(await page.evaluate(() => window.authFailureTest.storageFailures)).toBe(1)
		const selected = await currentIdentity(page)
		expect(selected).toBeTruthy()
		expect(selected).not.toBe(previous)
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveCount(0)
		await retry.click()
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
		expect(await currentIdentity(page)).toBe(selected)
		await expectEmptyRecoveryDraft(page)
		await page.reload()
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
		expect(await currentIdentity(page)).toBe(selected)
		await page.goto('/accounts')
		await expect(
			page.getByRole('cell', { name: 'Previous selection checking', exact: true })
		).toHaveCount(0)
	}
)

test(
	'recoverable restore failure keeps the original client and generic feedback after remount',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await createAccount(page, 'Recoverable checking')
		const identity = await currentIdentity(page)
		await page.goto('/account')
		await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
		const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		await page.goto('/login')
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
		await page.evaluate(async () => {
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const schemaPath = '/src/lib/schema.ts'
			const { getCurrentJazzSession }: typeof import('../src/lib/runtime/jazz-session.js') =
				await import(sessionPath)
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const db = getCurrentJazzSession()?.getSnapshot().client?.db
			if (!db) throw new Error('Test session is not ready.')
			const account = await db.one(app.accounts)
			if (!account) throw new Error('Missing recovery account')
			await db.disconnect()
			await db
				.insert(app.accounts, {
					organizationId: account.organizationId,
					name: 'Pending recovery qualification',
					kind: 'cash',
					currency: 'USD'
				})
				.wait({ tier: 'local' })
			window.authFailureTest = {
				shutdownAttempts: 0,
				storageFailures: 0,
				releaseSharedClient: () => db.reconnect(),
				abortShutdown: () => db.abortGracefulShutdown()
			}
		})
		try {
			await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
			await page.getByRole('button', { name: 'Login', exact: true }).click()
			// Abort the SDK's real graceful wait. The SDK emits its native recoverable
			// shutdown error and retains the original client; frozen sessions stay intact.
			await expect
				.poll(async () => {
					await page.evaluate(() => window.authFailureTest.abortShutdown?.())
					return page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ }).isVisible()
				})
				.toBe(true)
			await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
				'The account could not be restored. Please try again.'
			)
			expect(await currentIdentity(page)).toBe(identity)
			await expectEmptyRecoveryDraft(page)
			await expect(page.getByRole('button', { name: 'Login', exact: true })).toBeEnabled()
		} finally {
			await page.evaluate(async () => {
				await window.authFailureTest.releaseSharedClient?.()
			})
		}
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		await expect(page).toHaveURL((url) => url.pathname === '/')
		expect(await currentIdentity(page)).toBe(identity)
		await page.goto('/accounts')
		await expect(
			page.getByRole('cell', { name: 'Recoverable checking', exact: true })
		).toBeVisible()
	}
)

declare global {
	interface Window {
		recoveryNavigationTest: { restoreCalls: number; navigationFailures: number }
	}
}

test(
	'recovery navigation failure retries navigation without restoring the account again',
	{ tag: ['@identity'] },
	async ({ page }) => {
		await createAccount(page, 'Navigation retained checking')
		const identity = await currentIdentity(page)
		const workspaceId = await page.getByLabel('Current Workspace', { exact: true }).inputValue()
		await page.goto('/account')
		await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
		const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		await page.goto('/login')
		await expect(page.getByLabel('Recovery phrase', { exact: true })).toBeVisible()
		await page.evaluate(async () => {
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const {
				getCurrentJazzSession,
				loadLocalFirstClient
			}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
			const session = getCurrentJazzSession()
			if (!session) throw new Error('Session unavailable')
			window.recoveryNavigationTest = { restoreCalls: 0, navigationFailures: 0 }
			// Count each SDK restore transition through its public subscription.
			session.subscribe(() => {
				if (session.getSnapshot().pending === 'restoreLocalFirst')
					window.recoveryNavigationTest.restoreCalls += 1
			})

			const NativeURL = URL
			window.URL = class extends NativeURL {
				constructor(url: string | URL, base?: string | URL) {
					// Fail before the router starts committing history or updating its internal route state.
					if (url === '/') {
						window.URL = NativeURL
						window.recoveryNavigationTest.navigationFailures += 1
						throw new TypeError('Simulated destination parsing failure')
					}
					super(url, base)
				}
			}
		})
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		await expect(page.getByRole('main').getByRole('alert').filter({ hasText: /\S/ })).toHaveText(
			'Your account was restored, but the destination could not be opened. Try again or use the navigation links.'
		)
		expect(await currentIdentity(page)).toBe(identity)
		await expectEmptyRecoveryDraft(page)
		await page.getByRole('button', { name: 'Try again', exact: true }).click()
		await expect(page).toHaveURL((url) => url.pathname === '/')
		await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
		expect(await page.evaluate(() => window.recoveryNavigationTest)).toEqual({
			restoreCalls: 1,
			navigationFailures: 1
		})
		await page.goto(`/accounts?workspace=${workspaceId}`)
		await expect(
			page.getByRole('cell', { name: 'Navigation retained checking', exact: true })
		).toBeVisible()
	}
)

test(
	'sign-in with several workspaces automatically selects the initial workspace',
	{ tag: ['@identity', '@workspaces'] },
	async ({ page }) => {
		await createAccount(page, 'Original identity ledger')
		const initialWorkspace = new URL(page.url()).searchParams.get('workspace')
		if (!initialWorkspace) throw new Error('Missing initial workspace')
		await page.goto('/account')
		await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
		const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		const previousWorkspace = await page.evaluate(async () => {
			const schemaPath = '/src/lib/schema.ts'
			const sessionPath = '/src/lib/runtime/jazz-session.ts'
			const { app }: typeof import('../src/lib/schema.js') = await import(schemaPath)
			const {
				getCurrentJazzSession,
				loadLocalFirstClient
			}: typeof import('../src/lib/runtime/jazz-session.js') = await import(sessionPath)
			const snapshot = getCurrentJazzSession()?.getSnapshot()
			if (!snapshot?.client || !snapshot.account) throw new Error('Missing session')
			const db = snapshot.client.db
			const workspace = await db
				.insert(app.organizations, {
					name: 'Additional workspace',
					kind: 'business',
					defaultCurrency: 'USD',
					ownerId: snapshot.account.id
				})
				.wait({ tier: 'local' })
			await db
				.insert(app.organizationMembers, {
					organizationId: workspace.id,
					userId: snapshot.account.id,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'local' })
			return workspace.id
		})
		await page.goto(`/login?workspace=${previousWorkspace}`)
		await page.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await page.getByRole('button', { name: 'Login', exact: true }).click()
		await expect(page).toHaveURL(
			(url) => url.pathname === '/' && url.searchParams.get('workspace') === initialWorkspace
		)
		await prepareSidebar(page)
		await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(
			initialWorkspace
		)
		await navigateSidebar(page, 'Expenses')
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === '/expenses' && url.searchParams.get('workspace') === initialWorkspace
		)
	}
)
