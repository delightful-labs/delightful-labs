import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { build } from 'vite'

const consumers = [
	{
		name: 'close',
		source: 'worker-host-close.ts',
		subpath: 'delightful-local-first/worker/host-close'
	},
	{
		name: 'broker-owned',
		source: 'worker-broker-owned.ts',
		subpath: 'delightful-local-first/backend/jazz/worker-broker'
	},
	{
		name: 'broker',
		source: 'worker-broker.ts',
		subpath: 'delightful-local-first/backend/jazz/worker-broker'
	}
]
await mkdir('.svelte-kit', { recursive: true })
const directory = await mkdtemp(resolve('.svelte-kit/worker-transport-consumer-'))
try {
	const destination = join(directory, 'node_modules/delightful-local-first')
	await mkdir(destination, { recursive: true })
	const archive = join(directory, 'library.tgz')
	execFileSync('pnpm', ['pack', '--out', archive], { stdio: 'pipe' })
	execFileSync('tar', ['-xzf', archive, '--strip-components', '1', '-C', destination])
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({ private: true, type: 'module' })
	)
	for (const consumer of consumers)
		await copyFile(
			'fixtures/package-consumer/' + consumer.source,
			join(directory, 'consumer-' + consumer.name + '.ts')
		)
	await writeFile(
		join(directory, 'tsconfig.json'),
		JSON.stringify({
			extends: resolve('tsconfig.json'),
			compilerOptions: {
				paths: {},
				module: 'NodeNext',
				moduleResolution: 'NodeNext',
				types: [],
				skipLibCheck: false,
				exactOptionalPropertyTypes: true
			},
			include: ['./consumer-*.ts'],
			exclude: []
		})
	)
	execFileSync(
		process.execPath,
		[resolve('node_modules/typescript/bin/tsc'), '--project', join(directory, 'tsconfig.json')],
		{ stdio: 'pipe' }
	)
	for (const consumer of consumers) {
		const entry = createRequire(join(directory, 'package.json')).resolve(consumer.subpath)
		if (!entry.startsWith(destination))
			throw new Error('Consumer did not resolve the packed export')
		execFileSync(
			process.execPath,
			['--experimental-strip-types', join(directory, 'consumer-' + consumer.name + '.ts')],
			{ stdio: 'pipe' }
		)
		const driver = join(directory, 'driver-' + consumer.name + '.ts')
		await writeFile(
			driver,
			`export function open() { return new Worker(new URL('./consumer-${consumer.name}.ts', import.meta.url), { type: 'module' }) }`
		)
		await build({
			configFile: false,
			root: directory,
			logLevel: 'silent',
			worker: {
				format: 'es',
				plugins: () => [
					{
						name: 'packed-worker-transport',
						generateBundle(_options, bundle) {
							if (![...this.getModuleIds()].includes(entry))
								this.error('Worker did not use its packed public export')
							for (const output of Object.values(bundle))
								if (
									output.type === 'chunk' &&
									(output.imports.length || output.dynamicImports.length)
								)
									this.error('Consumer worker retained an external runtime import')
						}
					}
				]
			},
			build: {
				write: false,
				target: 'esnext',
				rolldownOptions: { input: driver, preserveEntrySignatures: 'strict' }
			}
		})
	}
	console.log(
		'Packed close/root-broker/owned-broker consumers: public types, native effects/receipts and self-contained ES-module workers passed.'
	)
} finally {
	await rm(directory, { recursive: true, force: true })
}
