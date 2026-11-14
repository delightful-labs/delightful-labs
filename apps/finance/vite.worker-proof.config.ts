import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { z } from 'zod'
import { workerRuntimeBuildConfig } from './tooling/jazz-wasm.js'

const root = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)
const versionSchema = z.object({ version: z.string() })
const graphSchema = z.object({ entry: z.string() })
const applicationEntry = 'src/lib/runtime/worker/application.worker.ts'
const windowBindingEntry = resolve(root, 'src/lib/runtime/worker/broker-host.ts')
const windowBindingExports = ['serveFinanceGenerationGrant', 'serveFinanceBrokerGrant']
const publicEntries = [
	'jazz-tools/client',
	'jazz-tools/local-first',
	'delightful-local-first/backend/jazz/session',
	'delightful-local-first/backend/jazz/startup',
	'delightful-local-first/session/workflow',
	'delightful-local-first/worker/channel/workflow',
	'delightful-local-first/worker/effect-drain/workflow',
	'delightful-local-first/backend/jazz/account-store/indexeddb',
	'delightful-local-first/backend/jazz/worker-broker'
]
const requiredImplementations = [
	'/jazz-tools/dist/session/create-jazz-session.js',
	'/jazz-tools/dist/runtime/default-create-db.js',
	'/delightful-local-first/dist/backend/jazz/session.js',
	'/delightful-local-first/dist/backend/jazz/startup.js',
	'/delightful-local-first/dist/machines/identity/session-acquisition.js',
	'/delightful-local-first/dist/machines/lifecycle/worker-channel.js',
	'/delightful-local-first/dist/machines/lifecycle/worker-effect-drain.js',
	'/delightful-local-first/dist/backend/jazz/indexeddb-account-store.js',
	'/delightful-local-first/dist/machines/identity/indexeddb-account-store.js',
	'/delightful-local-first/dist/storage/indexeddb-account-store-native.js',
	'/delightful-local-first/dist/backend/jazz/worker-broker.js',
	'src/lib/runtime/worker/grant-binding.ts',
	'src/lib/runtime/worker/grant-protocol.ts',
	'src/lib/machines/runtime/worker-grant-owner.ts'
]
const portable = (id: string) => (isAbsolute(id) ? relative(root, id).replaceAll('\\', '/') : id)
const clean = (id: string) => id.split('?')[0] ?? id
const uiModule = (id: string) =>
	/\.svelte(?:\.[cm]?[jt]s)?$/.test(clean(id)) || /\/jazz-tools\/dist\/svelte\//.test(id)

function workerGraphReport(): Plugin {
	return {
		name: 'finance-worker-proof-graph',
		generateBundle(_options, bundle) {
			const resolved = Array.from(this.getModuleIds()).map((id) => ({
				id: portable(id),
				imports: this.getModuleInfo(id)?.importedIds.map(portable) ?? [],
				dynamicImports: this.getModuleInfo(id)?.dynamicallyImportedIds.map(portable) ?? []
			}))
			const forbidden = resolved.filter((module) => uiModule(module.id))
			if (forbidden.length)
				this.error(`UI modules in worker graph: ${forbidden.map((m) => m.id).join(', ')}`)
			const chunks = Object.values(bundle).filter((output) => output.type === 'chunk')
			const entry = chunks.find((chunk) => chunk.isEntry)?.facadeModuleId
			if (!entry) this.error('Worker proof graph has no entry')
			for (const chunk of chunks) {
				for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) {
					if (!Object.hasOwn(bundle, dependency))
						this.error(`Unbundled worker dependency: ${dependency}`)
				}
			}
			const rendered = chunks.flatMap((chunk) =>
				Object.entries(chunk.modules).map(([id, module]) => ({
					id: portable(id),
					bytes: module.renderedLength,
					exports: module.renderedExports
				}))
			)
			if (portable(clean(entry)) === applicationEntry) {
				for (const expected of requiredImplementations) {
					if (!rendered.some((module) => clean(module.id).endsWith(expected) && module.bytes > 0))
						this.error(`Worker proof omitted implementation: ${expected}`)
				}
			}
			const key = createHash('sha256').update(portable(entry)).digest('hex').slice(0, 12)
			this.emitFile({
				type: 'asset',
				fileName: `reports/worker-graph-${key}.json`,
				source: JSON.stringify(
					{
						entry: portable(entry),
						resolved,
						rendered,
						chunks: chunks.map((chunk) => ({
							file: chunk.fileName,
							imports: chunk.imports,
							dynamicImports: chunk.dynamicImports
						}))
					},
					null,
					2
				)
			})
		}
	}
}

function artifactReport(): Plugin {
	return {
		name: 'finance-worker-proof-artifacts',
		generateBundle: {
			order: 'post',
			handler(_options, bundle) {
				const windowBindingPresent = Object.values(bundle).some(
					(output) =>
						output.type === 'chunk' &&
						Object.entries(output.modules).some(
							([id, module]) =>
								clean(id) === windowBindingEntry &&
								module.renderedLength > 0 &&
								windowBindingExports.every((name) => module.renderedExports.includes(name))
						)
				)
				if (!windowBindingPresent) this.error('Worker proof omitted Finance Window broker binding')
				const files = Object.values(bundle)
					.map((output) => output.fileName)
					.sort()
				if (!files.some((file) => file.endsWith('.wasm')))
					this.error('Worker proof emitted no Wasm asset')
				const reports = Object.values(bundle).flatMap((output) => {
					if (output.type !== 'asset' || !output.fileName.startsWith('reports/worker-graph-'))
						return []
					const source =
						typeof output.source === 'string'
							? output.source
							: new TextDecoder().decode(output.source)
					const decoded: unknown = JSON.parse(source)
					return [graphSchema.parse(decoded)]
				})
				if (!reports.some((report) => report.entry === applicationEntry))
					this.error('Worker proof omitted the Finance application entry graph')
				const packages = ['jazz-tools', 'xstate', 'vite'].map((name) => {
					const decoded: unknown = JSON.parse(
						readFileSync(require.resolve(`${name}/package.json`), 'utf8')
					)
					return { name, version: versionSchema.parse(decoded).version }
				})
				const foundationPackage = resolve(
					dirname(require.resolve('delightful-local-first/backend/jazz/session')),
					'../../../package.json'
				)
				const foundation: unknown = JSON.parse(readFileSync(foundationPackage, 'utf8'))
				packages.push({
					name: 'delightful-local-first',
					version: versionSchema.parse(foundation).version
				})
				this.emitFile({
					type: 'asset',
					fileName: 'worker-proof.json',
					source: JSON.stringify(
						{
							scope: 'build-only; no runtime activation',
							windowBinding: portable(windowBindingEntry),
							windowBindingExports,
							packages,
							publicEntries: publicEntries.map((entry) => ({
								entry,
								resolved: portable(require.resolve(entry))
							})),
							files
						},
						null,
						2
					)
				})
			}
		}
	}
}

const runtime = workerRuntimeBuildConfig()
export default defineConfig({
	...runtime,
	worker: { ...runtime.worker, plugins: () => [workerGraphReport()] },
	plugins: [artifactReport()],
	build: {
		outDir: '.svelte-kit/worker-build-proof',
		emptyOutDir: true,
		assetsInlineLimit: 0,
		rolldownOptions: {
			input: resolve(root, 'tooling/worker-proof-driver.ts'),
			preserveEntrySignatures: 'strict',
			output: { entryFileNames: 'worker-proof-driver.js' }
		}
	}
})
