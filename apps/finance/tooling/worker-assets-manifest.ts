import type { Plugin } from 'vite'
import { z } from 'zod'

const manifestSchema = z.record(
	z.string(),
	z.object({ file: z.string(), assets: z.array(z.string()).optional() }).passthrough()
)

/** Include emitted worker dependencies in the manifest consumed by SvelteKit's precache list. */
export function workerAssetsManifest(): Plugin {
	return {
		name: 'finance-worker-assets-manifest',
		apply: 'build',
		configResolved(config) {
			const output = config.worker.rolldownOptions.output
			for (const entry of Array.isArray(output) ? output : [output])
				if (entry) entry.assetFileNames = '_app/immutable/assets/[name].[hash][extname]'
		},
		applyToEnvironment: (environment) => environment.name === 'client',
		generateBundle: {
			order: 'post',
			handler(_options, bundle) {
				const setting = this.environment.config.build.manifest
				const manifestPath = typeof setting === 'string' ? setting : '.vite/manifest.json'
				const output = bundle[manifestPath]
				if (output?.type !== 'asset') {
					this.error('Worker asset precaching requires the generated Vite client manifest')
				}
				const source =
					typeof output.source === 'string'
						? output.source
						: new TextDecoder().decode(output.source)
				const decoded: unknown = JSON.parse(source)
				const manifest = manifestSchema.parse(decoded)
				const listed = new Set(
					Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.assets ?? [])])
				)
				for (const asset of Object.values(bundle)) {
					if (
						asset.type === 'asset' &&
						asset.fileName.startsWith('_app/immutable/') &&
						!asset.fileName.endsWith('.map') &&
						!listed.has(asset.fileName)
					) {
						manifest[`_worker_asset:${asset.fileName}`] = { file: asset.fileName }
					}
				}
				output.source = JSON.stringify(manifest, null, 2)
			}
		}
	}
}
