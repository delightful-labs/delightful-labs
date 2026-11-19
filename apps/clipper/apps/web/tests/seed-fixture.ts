import { test as base } from '@playwright/test'
import type { Page, BrowserContext } from '@playwright/test'

/** Only closes an already initialized fixture; never imports/creates a seed SDK. */
export async function closeSeedReplica(target: Page | BrowserContext): Promise<void> {
	if ('pages' in target) {
		for (const page of target.pages()) await closeSeedReplica(page)
		return
	}
	if (target.isClosed()) return // Abrupt loss supplies no clean receipt.
	await target.evaluate(async () => {
		await window.closeClipperSeedReplica?.()
	})
}

export const test = base.extend({
	page: async ({ page }, use) => {
		try {
			await use(page)
		} finally {
			await closeSeedReplica(page)
		}
	}
})
