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
	expect(manifestSchema.parse(decoded).publicEntries.map((entry) => entry.entry)).toEqual(
		expect.arrayContaining([
			'jazz-tools/local-first',
			'delightful-local-first/backend/jazz/session',
			'delightful-local-first/worker/channel/workflow'
		])
	)
	const wasm = result.output.find((output) => output.fileName.endsWith('.wasm'))
	if (wasm?.type !== 'asset' || typeof wasm.source === 'string')
		throw new Error('Missing binary Wasm module')
	expect([...wasm.source.subarray(0, 4)]).toEqual([0, 97, 115, 109])
}, 20_000)

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
