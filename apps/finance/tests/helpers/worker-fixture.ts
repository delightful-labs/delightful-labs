import type { Page } from '@playwright/test'
import type {
	FixtureOperation,
	FixtureArguments,
	FixtureResult
} from '../fixtures/worker/window.js'
export async function financeFixture<Key extends FixtureOperation>(
	page: Page,
	operation: Key,
	...args: FixtureArguments<Key>
): Promise<FixtureResult<Key>> {
	await page.waitForFunction(() => Boolean(window.financeFixture))
	// These static fixture arguments are JSON data. Playwright evaluates string
	// expressions directly, so invoke the request rather than returning a function.
	return page.evaluate<FixtureResult<Key>>(
		`window.financeFixture.request(${JSON.stringify(operation)}, ${JSON.stringify(args)})`
	)
}
