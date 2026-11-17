import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Isolated native schema port, not an application migration or compatibility layer. */
export async function checkFinanceSchema(directory, finance, proof, versions) {
	const run = (args, cwd) => execFileSync('pnpm', args, { cwd, stdio: 'inherit' })
	const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
	const legacy = join(directory, 'legacy')
	const app = join(directory, 'app')
	for (const [path, sdk] of [
		[legacy, '2.0.0-alpha.60'],
		[app, 'file:../candidate-sdk.tgz']
	]) {
		mkdirSync(path)
		cpSync(join(finance, 'src'), join(path, 'src'), { recursive: true })
		json(join(path, 'package.json'), {
			name: 'finance-schema-upgrade-proof',
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
	cpSync(join(proof, 'schema-seed.mjs'), join(legacy, 'schema-seed.mjs'))
	run(['exec', 'node', 'schema-seed.mjs', app], legacy)
	// The legacy compiler supplies comparison metadata only; it is never a live rollout.
	run(['add', '--ignore-scripts', 'jazz-tools@2.0.0-alpha.65'], legacy)
	run(['exec', 'jazz-tools', 'validate'], legacy)
	execFileSync(
		'git',
		['apply', '--check', '--whitespace=error-all', join(proof, 'finance-schema.patch')],
		{ cwd: app, stdio: 'inherit' }
	)
	execFileSync('git', ['apply', join(proof, 'finance-schema.patch')], {
		cwd: app,
		stdio: 'inherit'
	})
	// Only copied callers move from authoring schema.ts to native runtime queries.
	const lib = join(app, 'src/lib')
	function updateImports(path) {
		for (const item of readdirSync(path, { withFileTypes: true })) {
			const file = join(path, item.name)
			if (item.isDirectory()) updateImports(file)
			else if (file.endsWith('.ts') && !['schema.ts', 'permissions.ts'].includes(item.name)) {
				const text = readFileSync(file, 'utf8').replace(
					/'([^']*schema\.js)'/g,
					(matched, specifier) =>
						specifier === '#lib/schema.js'
							? "'#lib/queries.js'"
							: resolve(dirname(file), specifier) === join(lib, 'schema.js')
								? `'${specifier.replace(/schema\.js$/, 'queries.js')}'`
								: matched
				)
				writeFileSync(file, text)
			}
		}
	}
	updateImports(lib)
	for (const name of [
		'permissions.test.ts',
		'bank-sync-log-permissions.test.ts',
		'bank-sync-log-retention-permissions.test.ts'
	]) {
		const file = join(lib, name)
		writeFileSync(
			file,
			readFileSync(file, 'utf8')
				.replace(
					"import permissions from './permissions.js'",
					"import permissions from './jazz.permissions.json' with { type: 'json' }"
				)
				.replaceAll("import('jazz-tools').schema.InsertOf", "import('jazz-tools').InsertOf")
		)
	}
	for (const name of ['tsconfig.schema.json', 'vitest.schema.config.mjs'])
		cpSync(join(proof, name), join(app, name))
	run(['exec', 'jazz-tools', 'migrations', 'create', '--name', 'initial'], app)
	run(['exec', 'jazz-tools', 'generate'], app)
	run(['exec', 'jazz-tools', 'generate', '--check'], app)
	run(['exec', 'tsc', '--project', 'tsconfig.schema.json'], app)
	const installed = createRequire(join(app, 'package.json'))
	const sdk = dirname(installed.resolve('jazz-tools/package.json'))
	assert.equal(installed('jazz-tools/package.json').version, '2.0.0-alpha.66')
	const core = createRequire(join(sdk, 'package.json')).resolve('jazz-napi')
	assert.equal(
		JSON.parse(readFileSync(join(dirname(core), 'package.json'), 'utf8')).version,
		'2.0.0-alpha.66'
	)
	// Use the pinned SDK upgrader's own identity comparison, not an application hash model.
	const { artifactIdentity, identityDifferences } = await import(
		pathToFileURL(join(sdk, 'dist/upgrade/index.js'))
	)
	const identity = (path) =>
		artifactIdentity(
			readFileSync(join(path, 'jazz.app.json'), 'utf8'),
			readFileSync(join(path, 'jazz.permissions.json'), 'utf8')
		)
	const before = await identity(join(legacy, 'src/lib'))
	const after = await identity(lib)
	const retained = JSON.parse(readFileSync(join(app, 'retained-baseline.json'), 'utf8'))
	assert.equal(after.current, retained.schemaHash)
	assert.deepEqual(identityDifferences(before, after), [])
	json(join(directory, 'schema-identity.json'), {
		alpha60: retained.schemaHash,
		alpha65: before,
		alpha66: after
	})
	run(['exec', 'vitest', 'run', '--config', 'vitest.schema.config.mjs'], app)
}
