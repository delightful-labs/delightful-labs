import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyHistoricalSource } from './history-source.mjs'

export function portRuntimeImports(path, lib, runtimeEntry, clipper) {
	for (const item of readdirSync(path, { withFileTypes: true })) {
		const file = join(path, item.name)
		if (item.isDirectory()) portRuntimeImports(file, lib, runtimeEntry, clipper)
		else if (
			(file.endsWith('.ts') || file.endsWith('.svelte')) &&
			!['schema.ts', 'permissions.ts'].includes(item.name)
		) {
			const text = readFileSync(file, 'utf8').replace(
				/'([^']*schema\.js)'/g,
				(matched, specifier) =>
					specifier === '#lib/schema.js'
						? "'#lib/queries.js'"
						: resolve(dirname(file), specifier) === join(lib, 'schema.js')
							? `'${specifier.replace(/schema\.js$/, runtimeEntry)}'`
							: matched
			)
			writeFileSync(
				file,
				clipper
					? text
							.replace(
								/^import \{ policySchema \} from '[^']+schema-permissions.test-support.js'\n/gm,
								''
							)
							.replaceAll('policySchema()', 'app')
							.replace(
								/import permissions from '([^']*)permissions.js'/g,
								"import permissions from '$1jazz.permissions.json' with { type: 'json' }"
							)
					: text
			)
		}
	}
}

/** Native generated bindings compared with a frozen historical producer, in disposable stores. */
export async function checkSchema(directory, source, proof, versions, scope, sdkVersion) {
	const run = (args, cwd) => execFileSync('pnpm', args, { cwd, stdio: 'inherit' })
	const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
	const clipper = scope === 'clipper'
	const schemaPath = clipper ? 'src/lib/backend/jazz' : 'src/lib'
	const prefix = clipper ? 'clipper-' : ''
	const legacy = join(directory, 'legacy')
	const baseline = join(directory, 'baseline')
	const app = join(directory, 'app')
	for (const [path, sdk] of [
		[legacy, '2.0.0-alpha.60'],
		[baseline, '2.0.0-alpha.67'],
		[app, 'file:../candidate-sdk.tgz']
	]) {
		mkdirSync(path)
		if (path === legacy) copyHistoricalSource(source, path)
		else cpSync(join(source, 'src'), join(path, 'src'), { recursive: true })
		json(join(path, 'package.json'), {
			name: `${scope}-schema-upgrade-proof`,
			private: true,
			type: 'module',
			imports: { '#lib/*': './src/lib/*' },
			pnpm: { overrides: { '@opentelemetry/api': versions['@opentelemetry/api'] } },
			dependencies: {
				...versions,
				'jazz-tools': sdk,
				'delightful-local-first': 'file:../local-first.tgz'
			}
		})
		writeFileSync(join(path, '.npmrc'), 'auto-install-peers=false\n')
		run(['install', '--ignore-scripts'], path)
	}
	// Native alpha.60 validation builds the approved migration index before bundling its schema.
	if (clipper) run(['exec', 'jazz-tools', 'validate', '--schema-dir', schemaPath], legacy)
	cpSync(join(proof, `${prefix}schema-seed.mjs`), join(legacy, 'schema-seed.mjs'))
	run(['exec', 'node', 'schema-seed.mjs', app], legacy)
	if (!clipper) {
		cpSync(join(proof, 'backup-seed.mjs'), join(legacy, 'backup-seed.mjs'))
		run(['exec', 'node', 'backup-seed.mjs', app], legacy)
	}
	cpSync(join(proof, 'fixtures', scope), app, { recursive: true })
	// Only copied callers move from authoring schema.ts to native runtime queries.
	const lib = join(app, schemaPath)
	const runtimeEntry = clipper ? 'jazz.generated.js' : 'queries.js'

	for (const name of ['tsconfig.schema.json', 'vitest.schema.config.mjs'])
		cpSync(join(proof, `${prefix}${name}`), join(app, name))
	if (!clipper) {
		mkdirSync(join(app, 'tooling'))
		cpSync(join(source, 'tooling/jazz-wasm.ts'), join(app, 'tooling/jazz-wasm.ts'))
		mkdirSync(join(app, 'tests/helpers'), { recursive: true })
		cpSync(
			join(source, 'tests/helpers/restore-probe.ts'),
			join(app, 'tests/helpers/restore-probe.ts')
		)
		cpSync(
			fileURLToPath(new URL('../../../../scripts/testing/silent-jazz-proxy.ts', import.meta.url)),
			join(app, 'tests/helpers/silent-jazz-proxy.ts')
		)
	}
	run(['exec', 'jazz-tools', 'generate', '--schema-dir', schemaPath], app)
	run(['exec', 'jazz-tools', 'generate', '--check', '--schema-dir', schemaPath], app)
	run(['exec', 'jazz-tools', 'generate', '--schema-dir', schemaPath], baseline)
	run(['exec', 'tsc', '--project', 'tsconfig.schema.json'], app)
	const installed = createRequire(join(app, 'package.json'))
	const sdk = dirname(installed.resolve('jazz-tools/package.json'))
	assert.equal(installed('jazz-tools/package.json').version, sdkVersion)
	const core = createRequire(join(sdk, 'package.json')).resolve('jazz-napi')
	assert.equal(
		JSON.parse(readFileSync(join(dirname(core), 'package.json'), 'utf8')).version,
		sdkVersion
	)
	// Beta removed the private upgrade helper. Compare each version's native
	// compiler output, including schema history, migrations and transforms.
	const compile = (path) => {
		const output = execFileSync(
			'pnpm',
			['exec', 'jazz-tools', 'schema', 'compile', '--schema-dir', schemaPath],
			{ cwd: path, encoding: 'utf8' }
		)
		writeFileSync(join(path, 'compiled-schema.json'), output)
		return JSON.parse(output)
	}
	const before = compile(baseline)
	const after = compile(app)
	const retained = JSON.parse(readFileSync(join(app, 'retained-baseline.json'), 'utf8'))
	assert.deepEqual(after, before)
	assert.ok(after.schema.schemas.some((schema) => schema.hash === retained.schemaHash))
	assert.deepEqual(
		JSON.parse(readFileSync(join(lib, 'jazz.permissions.json'), 'utf8')).tables,
		JSON.parse(readFileSync(join(baseline, schemaPath, 'jazz.permissions.json'), 'utf8')).tables
	)
	json(join(directory, 'schema-identity.json'), {
		alpha60: retained.schemaHash,
		'2.0.0-alpha.67': before.schema,
		[sdkVersion]: after.schema
	})
	run(['exec', 'vitest', 'run', '--config', 'vitest.schema.config.mjs'], app)
}
