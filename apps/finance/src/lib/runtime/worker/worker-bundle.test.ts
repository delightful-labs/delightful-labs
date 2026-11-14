import { expect, it } from 'vitest'
import { build, type Plugin } from 'vite'
import { z } from 'zod'
import proofConfig from '../../../../vite.worker-proof.config.js'

// Exercise real module-worker builds. Fixtures alter source/output, never mock
// plugin contexts or construct a second implementation of the expected graph.
function bundle(workerPlugin?: Plugin, artifactPlugin?: Plugin) {
	return build({
		...proofConfig,
		configFile: false,
		logLevel: 'silent',
		plugins: [...(artifactPlugin ? [artifactPlugin] : []), ...(proofConfig.plugins ?? [])],
		worker: {
			...proofConfig.worker,
			plugins: () => [
				...(proofConfig.worker?.plugins?.() ?? []),
				...(workerPlugin ? [workerPlugin] : [])
			]
		},
		build: { ...proofConfig.build, write: false }
	})
}

function replaceEntry(code: string): Plugin {
	return {
		name: 'worker-proof-source-fixture',
		transform(_source, id) {
			if (id.endsWith('/runtime/worker/application.worker.ts')) return code
		}
	}
}

const manifestSchema = z.object({
	scope: z.literal('build-only; no runtime activation'),
	windowBinding: z.literal('src/lib/runtime/worker/broker-host.ts'),
	windowBindingExports: z.array(z.string()),
	publicEntries: z.array(z.object({ entry: z.string() }))
})

it('bundles real SDK implementations, lazy chunks and a binary Wasm module', async () => {
	const result = await bundle()
	if (Array.isArray(result) || !('output' in result))
		throw new Error('Expected one generated bundle')
	const manifest = result.output.find((output) => output.fileName === 'worker-proof.json')
	if (manifest?.type !== 'asset') throw new Error('Missing proof manifest')
	const source =
		typeof manifest.source === 'string'
			? manifest.source
			: new TextDecoder().decode(manifest.source)
	const decoded: unknown = JSON.parse(source)
	expect(manifestSchema.parse(decoded).windowBindingExports).toEqual([
		'serveFinanceGenerationGrant',
		'serveFinanceBrokerGrant'
	])
	expect(manifestSchema.parse(decoded).publicEntries.map((entry) => entry.entry)).toEqual(
		expect.arrayContaining([
			'jazz-tools/local-first',
			'delightful-local-first/backend/jazz/session',
			'delightful-local-first/worker/channel/workflow',
			'delightful-local-first/backend/jazz/account-store/indexeddb',
			'delightful-local-first/backend/jazz/worker-broker'
		])
	)
	const wasm = result.output.find((output) => output.fileName.endsWith('.wasm'))
	if (wasm?.type !== 'asset' || typeof wasm.source === 'string')
		throw new Error('Missing binary Wasm module')
	expect([...wasm.source.subarray(0, 4)]).toEqual([0, 97, 115, 109])
}, 20_000)

it.each([
	{ factory: 'createFinanceAccountStore', implementation: 'indexeddb-account-store.js' },
	{ factory: 'brokerHostClient', implementation: 'worker-broker.js' }
])(
	'refuses a worker that omits the $factory implementation',
	async ({ factory, implementation }) => {
		const remove: Plugin = {
			name: 'worker-proof-missing-binding-fixture',
			enforce: 'pre',
			transform(code, id) {
				if (!id.endsWith('/runtime/worker/application.worker.ts')) return
				return code
					.split('\n')
					.filter(
						(line) =>
							!line.includes(`import { ${factory} }`) &&
							line.trim() !== `${factory},` &&
							(factory !== 'brokerHostClient' ||
								(!line.includes("from '../../machines/runtime/worker-grant-owner.js'") &&
									line.trim() !== 'createFinanceGrantOwner,'))
					)
					.join('\n')
			}
		}
		await expect(bundle(remove)).rejects.toThrow(
			`Worker proof omitted implementation: /delightful-local-first/dist/backend/jazz/${implementation}`
		)
	},
	20_000
)

it.each([
	{
		missing: 'grant-binding.ts',
		imports: ['grant-binding.js', 'grant-protocol.js'],
		factories: [
			'financeGrantDescriptor',
			'financeGrantKey',
			'decodeFinanceGrantRequest',
			'decodeFinanceGrantReply'
		]
	},
	{
		missing: 'grant-protocol.ts',
		imports: ['grant-protocol.js'],
		factories: ['decodeFinanceGrantRequest', 'decodeFinanceGrantReply']
	}
])(
	'refuses a worker that omits the private $missing contract',
	async ({ missing, imports, factories }) => {
		const remove: Plugin = {
			name: 'worker-proof-missing-grant-contract',
			enforce: 'pre',
			transform(code, id) {
				if (!id.endsWith('/runtime/worker/application.worker.ts')) return
				return code
					.split('\n')
					.filter(
						(line) =>
							!line.includes("from '../../machines/runtime/worker-grant-owner.js'") &&
							line.trim() !== 'createFinanceGrantOwner,' &&
							!imports.some((module) => line.includes(`from './${module}'`)) &&
							!factories.some((factory) => line.trim() === `${factory},`)
					)
					.join('\n')
			}
		}
		await expect(bundle(remove)).rejects.toThrow(
			`Worker proof omitted implementation: src/lib/runtime/worker/${missing}`
		)
	},
	20_000
)

it('refuses a worker that omits the grant-owner implementation', async () => {
	const remove: Plugin = {
		name: 'worker-proof-missing-grant-owner',
		enforce: 'pre',
		transform(code, id) {
			if (!id.endsWith('/runtime/worker/application.worker.ts')) return
			return code
				.split('\n')
				.filter(
					(line) =>
						!line.includes("from '../../machines/runtime/worker-grant-owner.js'") &&
						line.trim() !== 'createFinanceGrantOwner,'
				)
				.join('\n')
		}
	}
	await expect(bundle(remove)).rejects.toThrow(
		'Worker proof omitted implementation: src/lib/machines/runtime/worker-grant-owner.ts'
	)
}, 20_000)

it.each(['serveFinanceGenerationGrant', 'serveFinanceBrokerGrant'])(
	'refuses a proof that omits the real Window adapter %s',
	async (factory) => {
		const remove: Plugin = {
			name: 'worker-proof-missing-window-binding-fixture',
			enforce: 'pre',
			transform(code, id) {
				if (id.endsWith('/tooling/worker-proof-driver.ts'))
					return code
						.split('\n')
						.filter((line) => line.trim().replace(/,$/u, '') !== factory)
						.join('\n')
			}
		}
		await expect(bundle(undefined, remove)).rejects.toThrow(
			'Worker proof omitted Finance Window broker binding'
		)
	},
	20_000
)

it.each([
	'/worker-proof/Forbidden.svelte.js',
	'/worker-proof/node_modules/jazz-tools/dist/svelte/index.js'
])(
	'refuses the resolved UI dependency %s',
	async (id) => {
		const inject: Plugin = {
			name: 'worker-proof-ui-fixture',
			resolveId(source) {
				if (source === 'proof-ui') return id
			},
			load(source) {
				if (source === id) return 'export const injected = 1'
			},
			transform(code, source) {
				if (source.endsWith('/runtime/worker/application.worker.ts'))
					return `${code}\nimport { injected } from 'proof-ui'; self.postMessage(injected)`
			}
		}
		await expect(bundle(inject)).rejects.toThrow('UI modules in worker graph')
	},
	20_000
)

it('refuses an entry that omits the SDK and shared runtime implementations', async () => {
	await expect(bundle(replaceEntry('self.postMessage("empty proof")'))).rejects.toThrow(
		'Worker proof omitted implementation'
	)
}, 20_000)

it('refuses an externalized worker dependency instead of accepting a broken chunk graph', async () => {
	const inject: Plugin = {
		name: 'worker-proof-external-fixture',
		resolveId(id) {
			if (id === 'unbundled-worker-capability') return { id, external: true }
		},
		transform(code, id) {
			if (id.endsWith('/runtime/worker/application.worker.ts'))
				return `${code}\nimport { injected } from 'unbundled-worker-capability'; self.postMessage(injected)`
		}
	}
	await expect(bundle(inject)).rejects.toThrow('Unbundled worker dependency')
}, 20_000)

it.each([
	{ kind: 'Wasm', missing: '.wasm', error: 'Worker proof emitted no Wasm asset' },
	{
		kind: 'Finance graph',
		missing: '.json',
		error: 'Worker proof omitted the Finance application entry graph'
	}
])(
	'refuses missing $kind output',
	async ({ missing, error }) => {
		const omit: Plugin = {
			name: 'worker-proof-missing-output-fixture',
			generateBundle: {
				order: 'post',
				handler(_options, output) {
					for (const file of Object.keys(output)) if (file.endsWith(missing)) delete output[file]
				}
			}
		}
		await expect(bundle(undefined, omit)).rejects.toThrow(error)
	},
	20_000
)

it('does not confuse a component filename in a string with a resolved UI import', async () => {
	const note: Plugin = {
		name: 'worker-proof-harmless-string-fixture',
		transform(code, id) {
			if (id.endsWith('/runtime/worker/application.worker.ts'))
				return `${code}\nself.postMessage('JazzSvelteProvider.svelte')`
		}
	}
	await expect(bundle(note)).resolves.toBeDefined()
}, 20_000)
