import { glob } from 'node:fs/promises'
import { relative } from 'node:path'
import { expect, test } from '@playwright/test'
import type { ProviderRequest } from '../src/lib/machines/bank-sync/provider-request.js'

// This file checks the native module emitted by the actual production build,
// not the separate IIFE fixture used by the provider unit tests.
test.use({ serviceWorkers: 'block' })

for (const scenario of [
	{
		name: 'validated response',
		status: 200,
		body: JSON.stringify({ accounts: [], errors: [] }),
		expected: { ok: true, response: { accounts: [], errors: [] } }
	},
	{
		name: 'invalid JSON',
		status: 200,
		body: 'invalid JSON',
		expected: { ok: false, stage: 'decode' }
	},
	{
		name: 'HTTP failure',
		status: 502,
		body: 'private synthetic failure',
		expected: { ok: false, stage: 'http', status: 502 }
	}
]) {
	test(`production provider module worker returns a safe ${scenario.name}`, async ({
		page,
		context
	}) => {
		const root = '.svelte-kit/output/client'
		const files: string[] = []
		for await (const file of glob(`${root}/**/simplefin.worker-*.js`)) files.push(file)
		expect(files).toHaveLength(1)
		const file = files[0]
		if (!file) throw new Error('Missing production provider worker')
		const workerUrl = `/${relative(root, file).replaceAll('\\', '/')}`
		let requests = 0
		await context.route('**/api/simplefin', async (route) => {
			requests += 1
			expect(route.request().postDataJSON()).toMatchObject({
				operation: 'discover',
				url: 'https://synthetic.invalid/credential'
			})
			await route.fulfill({
				status: scenario.status,
				contentType: 'application/json',
				body: scenario.body
			})
		})
		await page.goto('/')
		const result = await page.evaluate(async (url) => {
			const worker = new Worker(url, { type: 'module' })
			try {
				return await new Promise<unknown>((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error('Provider worker reply overdue')), 10_000)
					const fail = () => {
						clearTimeout(timer)
						reject(new Error('Production provider worker failed'))
					}
					worker.onerror = fail
					worker.onmessageerror = fail
					worker.onmessage = ({ data }: MessageEvent<unknown>) => {
						clearTimeout(timer)
						resolve(data)
					}
					try {
						worker.postMessage({
							endpoint: new URL('/api/simplefin', location.origin).href,
							accessUrl: 'https://synthetic.invalid/credential',
							discovery: true,
							traceId: crypto.randomUUID()
						} satisfies ProviderRequest)
					} catch {
						fail()
					}
				})
			} finally {
				worker.onmessage = null
				worker.onerror = null
				worker.onmessageerror = null
				worker.terminate()
			}
		}, workerUrl)
		expect(result).toEqual(scenario.expected)
		expect(requests).toBe(1)
	})
}
