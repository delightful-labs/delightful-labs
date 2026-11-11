import { afterAll, afterEach, beforeAll, expect, it } from 'vitest'
import { build } from 'vite'
import { Worker } from 'node:worker_threads'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ProviderRequest } from '#lib/machines/bank-sync/provider-request.js'

// Exercise the emitted worker entry and structured-clone messages in an actual worker thread.
// Browser-specific behavior remains covered by Playwright; no socket or live provider is used here.
let directory = ''
const workers = new Set<Worker>()
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'finance-bank-worker-'))
	await build({
		configFile: false,
		logLevel: 'silent',
		resolve: { alias: { '#lib': resolve('src/lib') } },
		build: {
			outDir: directory,
			emptyOutDir: false,
			lib: {
				entry: resolve('src/lib/integrations/simplefin.worker.ts'),
				name: 'BankWorker',
				formats: ['iife'],
				fileName: () => 'provider-worker.js'
			}
		}
	})
	await writeFile(
		join(directory, 'runtime.mjs'),
		`
import { parentPort, workerData } from 'node:worker_threads'
globalThis.self = globalThis
let fetches = 0
globalThis.fetch = async () => {
	fetches += 1
	if (workerData.transportFailure) throw new Error('https://user:secret@bridge.simplefin.org/simplefin')
	return new Response(workerData.body, { status: workerData.status })
}
globalThis.postMessage = (value) => parentPort.postMessage({ value, fetches })
parentPort.on('message', (data) => globalThis.onmessage?.({ data }))
await import(workerData.entry)
parentPort.postMessage('ready')
`
	)
}, 20000)
afterEach(async () => {
	await Promise.all([...workers].map((worker) => worker.terminate()))
	workers.clear()
})
afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true })
})

function request(body: string, status = 200, transportFailure = false) {
	const worker = new Worker(pathToFileURL(join(directory, 'runtime.mjs')), {
		execArgv: [],
		workerData: {
			entry: pathToFileURL(join(directory, 'provider-worker.js')).href,
			body,
			status,
			transportFailure
		}
	})
	workers.add(worker)
	return new Promise<unknown>((resolve, reject) => {
		worker.on('error', reject)
		worker.on('message', (message: unknown) => {
			if (message === 'ready')
				worker.postMessage({
					endpoint: 'https://finance.example/api/simplefin',
					accessUrl: 'https://user:secret@bridge.simplefin.org/simplefin',
					discovery: false,
					traceId: crypto.randomUUID()
				} satisfies ProviderRequest)
			else resolve(message)
		})
	})
}

it('runs the production worker entry and returns a structured-cloned validated response', async () => {
	const response = {
		errors: [],
		accounts: [
			{
				id: 'checking',
				name: 'Checking',
				currency: 'USD',
				org: { 'sfin-url': 'https://bank.example' },
				transactions: [{ id: 'one', amount: '-1.00', posted: 1792000000, description: 'Synthetic' }]
			}
		]
	}
	await expect(request(JSON.stringify(response))).resolves.toEqual({
		value: { ok: true, response },
		fetches: 1
	})
})
it.each([
	{ body: 'not JSON', status: 200, stage: 'decode' },
	{ body: JSON.stringify({ accounts: [{ id: 'incomplete' }] }), status: 200, stage: 'validation' },
	{ body: 'private provider error', status: 502, stage: 'http' }
])(
	'returns a safe $stage failure from the emitted worker without retrying',
	async ({ body, status, stage }) => {
		await expect(request(body, status)).resolves.toEqual({
			value: { ok: false, stage, ...(stage === 'http' ? { status } : {}) },
			fetches: 1
		})
	}
)
it('never sends a raw credential-bearing transport error to the parent', async () => {
	await expect(request('', 200, true)).resolves.toEqual({
		value: { ok: false, stage: 'request' },
		fetches: 1
	})
})
