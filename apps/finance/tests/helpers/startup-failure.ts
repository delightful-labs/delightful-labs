import type { Page } from '@playwright/test'

/** Install a static native-platform fault before the real worker receives OPEN. */
export async function installWorkerFault(
	page: Page,
	module: 'fail-account-storage-once' | 'fail-bank-lock-once' | 'fail-workspace-journal'
) {
	await page.addInitScript((fault) => {
		window.financeWorkerFault = fault
	}, module)
}

export const failNextAccountStorageOpen = (page: Page) =>
	installWorkerFault(page, 'fail-account-storage-once')
