import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const environment = vi.hoisted(() => ({ PUBLIC_DEBUG: 'true' }))
vi.mock('$app/env/public', () => environment)

beforeEach(() => {
	vi.resetModules()
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

it.each(['true', 'false'])('cleans up trace heartbeats on success with debug=%s', async (flag) => {
	environment.PUBLIC_DEBUG = flag
	const info = vi.spyOn(console, 'info').mockImplementation(() => {})
	const { createBankTrace } = await import('./diagnostics.js')
	let finish: (value: number) => void = () => {}
	const pending = new Promise<number>((resolve) => {
		finish = resolve
	})
	const trace = createBankTrace('sync', 'test-trace')
	const result = trace.step('fetch', () => pending)
	await vi.advanceTimersByTimeAsync(10_000)
	if (flag === 'true') {
		expect(info).toHaveBeenCalledWith('[bank-sync] sync fetch:waiting', {
			traceId: 'test-trace',
			durationMs: 10_000
		})
	} else {
		expect(info).not.toHaveBeenCalled()
		expect(vi.getTimerCount()).toBe(0)
	}
	finish(42)
	await expect(result).resolves.toBe(42)
	expect(vi.getTimerCount()).toBe(0)
})

it('preserves rejection, clears its timer, and excludes sensitive error details', async () => {
	environment.PUBLIC_DEBUG = 'true'
	vi.spyOn(console, 'info').mockImplementation(() => {})
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	const { createBankTrace, safeBankError } = await import('./diagnostics.js')
	const failure = new Error('https://user:PRIVATE_PASSWORD@provider.invalid', {
		cause: Object.assign(new Error('PRIVATE_CAUSE'), { code: 'ECONNREFUSED' })
	})
	const trace = createBankTrace('sync', 'test-trace')
	await expect(trace.step('fetch', () => Promise.reject(failure))).rejects.toBe(failure)
	expect(vi.getTimerCount()).toBe(0)
	expect(warn).toHaveBeenCalledWith('[bank-sync] sync fetch:failed', {
		traceId: 'test-trace',
		errorType: 'Error',
		reason: 'unclassified',
		networkCode: 'ECONNREFUSED'
	})
	expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_')
	expect(safeBankError(new Error('WriteRejected: PRIVATE_RECORD'))).toMatchObject({
		reason: 'jazz-write-rejected'
	})
	expect(safeBankError(new Error('Storage: PRIVATE_RECORD'))).toMatchObject({
		reason: 'jazz-storage-failure'
	})
	expect(safeBankError(new Error('unauthorized'))).toMatchObject({ reason: 'unauthorized' })
})
