import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clipperProofVersions } from './clipper-versions.mjs'
import { checkSchema } from './schema.mjs'
import { checkFinanceWorker } from './worker-read.mjs'
import { copyCandidate } from './copy-candidate.mjs'

// Upgrade experiment only: reuse the maintained Finance fixture in a disposable
// project, with its own dependencies. No workspace pin or installed SDK is edited.
const finance = fileURLToPath(new URL('../../', import.meta.url))
const proof = dirname(fileURLToPath(import.meta.url))
const schemaScope = process.argv.includes('--clipper-schema')
	? 'clipper'
	: process.argv.includes('--schema')
		? 'finance'
		: undefined
const schemaOnly = schemaScope !== undefined
const workerOnly = process.argv.includes('--worker')
if (
	Number(schemaOnly) + Number(workerOnly) !== 1 ||
	(process.argv.includes('--schema') && process.argv.includes('--clipper-schema'))
)
	throw new Error('Choose --schema, --clipper-schema or --worker')
const selectedVersion = process.argv.find((argument) => argument.startsWith('--sdk='))?.slice(6)
if (selectedVersion !== undefined && selectedVersion !== '2.0.0-alpha.67')
	throw new Error('The maintained candidate is jazz-tools@2.0.0-alpha.67')
const sdkVersion = '2.0.0-alpha.67'
const directory = mkdtempSync(
	join(tmpdir(), `finance-jazz-${sdkVersion.replace('2.0.0-alpha.', 'alpha')}-`)
)
console.log(`Upgrade proof artifacts: ${directory}`)
const run = (command, args, cwd = directory) =>
	execFileSync(command, args, { cwd, stdio: 'inherit' })
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const metadataResponse = await fetch(`https://registry.npmjs.org/jazz-tools/${sdkVersion}`)
if (!metadataResponse.ok) throw new Error(`SDK metadata: ${metadataResponse.status}`)
const metadata = await metadataResponse.json()
if (metadata.version !== sdkVersion || !metadata.dist?.integrity?.startsWith('sha512-'))
	throw new Error('Unexpected SDK metadata')
const response = await fetch(metadata.dist.tarball)
if (!response.ok) throw new Error(`SDK tarball: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== metadata.dist.integrity)
	throw new Error('SDK tarball integrity mismatch')
json(join(directory, 'sdk-metadata.json'), metadata)
const tarball = join(directory, 'published-sdk.tgz')
writeFileSync(tarball, bytes)
const candidate = join(directory, 'candidate')
mkdirSync(candidate)
run('tar', ['-xzf', tarball, '-C', candidate])
const sdk = join(candidate, 'package')
if (!schemaOnly) {
	run(
		'git',
		['apply', '--check', '--whitespace=error-all', join(proof, 'worker-bridge.patch')],
		sdk
	)
	run('git', ['apply', join(proof, 'worker-bridge.patch')], sdk)
}
run('tar', ['-czf', join(directory, 'candidate-sdk.tgz'), '-C', candidate, 'package'])

// Pack the current built public libraries without generation/prepack hooks.
for (const name of ['local-first', 'ui']) {
	writeFileSync(
		join(directory, `pack-${name}.log`),
		execFileSync(
			'pnpm',
			['pack', '--config.ignore-scripts=true', '--out', join(directory, `${name}.tgz`)],
			{ cwd: join(finance, '../../packages', name) }
		)
	)
}
const packages = [
	'vite',
	'vitest',
	'@playwright/test',
	'typescript',
	'@types/node',
	'svelte',
	'svelte-check',
	'@sveltejs/vite-plugin-svelte',
	'@poppanator/sveltekit-svg',
	'tdesign-icons-svg',
	'pica',
	'xstate',
	'zod',
	'ws',
	'@opentelemetry/api'
]
// Read exact installed versions through pnpm; some packages hide package.json.
const workspacePackages = JSON.parse(
	execFileSync('pnpm', ['list', ...packages, '--depth', '0', '--json'], {
		cwd: finance,
		encoding: 'utf8'
	})
)
const versions = Object.fromEntries(
	packages.map((name) => {
		const dependency =
			workspacePackages[0].dependencies?.[name] ?? workspacePackages[0].devDependencies?.[name]
		if (!dependency) throw new Error(`Installed proof dependency missing: ${name}`)
		return [name, dependency.version]
	})
)
if (schemaOnly) {
	await checkSchema(
		directory,
		schemaScope === 'clipper' ? join(finance, '../clipper/apps/web') : finance,
		proof,
		schemaScope === 'clipper' ? clipperProofVersions(join(finance, '../clipper')) : versions,
		schemaScope,
		sdkVersion
	)
	console.log(`${schemaScope} schema proof passed; artifacts retained at ${directory}`)
	process.exit(0)
}
const app = join(directory, 'app')
if (workerOnly) await checkSchema(directory, finance, proof, versions, 'finance', sdkVersion)
else mkdirSync(app)
for (const path of [
	'src/lib/schema.ts',
	'src/lib/schema',
	'src/lib/domain',
	'src/lib/validation',
	'src/lib/runtime/worker/account-store.ts',
	'src/lib/components/identity/RecoveryPhraseIntegration.svelte',
	'src/lib/paraglide/runtime.js',
	'src/lib/paraglide/runtime.d.ts',
	'tests/worker-bindings',
	'tooling/jazz-wasm.ts',
	'vitest.worker-bindings.config.ts'
]) {
	// The schema pipeline already copied and ported the actual app source.
	if (workerOnly && path.startsWith('src/')) continue
	const target = join(app, path)
	mkdirSync(dirname(target), { recursive: true })
	cpSync(join(finance, path), target, { recursive: true })
}
run('git', ['apply', '--check', '--whitespace=error-all', join(proof, 'fixture.patch')], app)
run('git', ['apply', join(proof, 'fixture.patch')], app)
copyCandidate(join(proof, 'candidate/fixture'), app)
if (workerOnly) {
	for (const path of ['sdk-session.worker.ts', 'actor/session.ts']) {
		const worker = join(app, 'tests/worker-bindings', path)
		writeFileSync(
			worker,
			readFileSync(worker, 'utf8').replace(/src\/lib\/schema\.js/g, 'src/lib/queries.js')
		)
	}
}
run(
	'git',
	['apply', '--check', '--whitespace=error-all', join(proof, 'consumer-session.patch')],
	app
)
run('git', ['apply', join(proof, 'consumer-session.patch')], app)
json(join(app, 'package.json'), {
	name: 'finance-jazz-upgrade-proof',
	private: true,
	type: 'module',
	imports: { '#lib/*': './src/lib/*' },
	pnpm: { overrides: { '@opentelemetry/api': versions['@opentelemetry/api'] } },
	dependencies: {
		...versions,
		'jazz-tools': 'file:../candidate-sdk.tgz',
		'delightful-ui': 'file:../ui.tgz',
		'delightful-local-first': 'file:../local-first.tgz'
	}
})
// Explicit SDK peer versions prevent an implicit alpha.60 installation here.
writeFileSync(join(app, '.npmrc'), 'auto-install-peers=false\n')
json(join(app, 'tsconfig.json'), {
	compilerOptions: {
		target: 'ES2024',
		module: 'NodeNext',
		moduleResolution: 'NodeNext',
		lib: ['ES2024', 'DOM'],
		strict: true,
		exactOptionalPropertyTypes: true,
		noUncheckedIndexedAccess: true,
		skipLibCheck: true,
		resolveJsonModule: true,
		noEmit: true,
		types: ['node', 'vite/client', 'svelte']
	},
	include: [
		'tests/worker-bindings/**/*.ts',
		'tests/worker-bindings/**/*.svelte',
		'src/lib/components/identity/RecoveryPhraseIntegration.svelte',
		'tooling/jazz-wasm.ts',
		'vitest.worker-bindings.config.ts'
	]
})
run('pnpm', ['install', '--ignore-scripts'], app)
// Compile the selected shared session adapters against the candidate, then test their
// normal public package exports. Unrelated library code keeps its built output.
const library = join(finance, '../../packages/local-first')
const sources = join(app, 'session-adapters')
for (const path of [
	'src/lib/backend/jazz/recovery-phrase.ts',
	'src/lib/backend/jazz/restoration.ts',
	'src/lib/backend/jazz/session-readiness.ts',
	'src/lib/contracts/session-runtime.ts',
	'src/lib/contracts/recovery-phrase.ts',
	'src/lib/contracts/restoration.ts',
	'src/lib/contracts/session.ts'
]) {
	mkdirSync(dirname(join(sources, path)), { recursive: true })
	cpSync(join(library, path), join(sources, path))
}
run(
	'git',
	['apply', '--check', '--whitespace=error-all', join(proof, 'session-adapters.patch')],
	sources
)
run('git', ['apply', join(proof, 'session-adapters.patch')], sources)
copyCandidate(join(proof, 'candidate/local-first'), sources)
const adapted = join(directory, 'adapted-local-first')
mkdirSync(adapted)
run('tar', ['-xzf', join(directory, 'local-first.tgz'), '-C', adapted])
const adaptedManifest = JSON.parse(readFileSync(join(adapted, 'package/package.json'), 'utf8'))
adaptedManifest.exports['./backend/jazz/session-runtime'] = {
	types: './dist/backend/jazz/session-runtime.d.ts',
	default: './dist/backend/jazz/session-runtime.js'
}
json(join(adapted, 'package/package.json'), adaptedManifest)
json(join(sources, 'tsconfig.json'), {
	compilerOptions: {
		target: 'ES2024',
		module: 'NodeNext',
		moduleResolution: 'NodeNext',
		lib: ['ES2024', 'DOM'],
		strict: true,
		exactOptionalPropertyTypes: true,
		noUncheckedIndexedAccess: true,
		skipLibCheck: true,
		declaration: true,
		rootDir: './src/lib',
		outDir: join(adapted, 'package/dist')
	},
	include: [
		'src/lib/backend/jazz/recovery-phrase.ts',
		'src/lib/backend/jazz/restoration.ts',
		'src/lib/backend/jazz/session-readiness.ts',
		'src/lib/backend/jazz/session-runtime.ts'
	]
})
run('pnpm', ['exec', 'tsc', '--project', 'session-adapters/tsconfig.json'], app)
run('tar', ['-czf', join(directory, 'adapted-local-first.tgz'), '-C', adapted, 'package'])
run(
	'pnpm',
	['add', '--ignore-scripts', 'delightful-local-first@file:../adapted-local-first.tgz'],
	app
)
const installed = createRequire(join(app, 'package.json'))
const wasm = createRequire(installed.resolve('jazz-tools/package.json'))
if (
	installed('jazz-tools/package.json').version !== sdkVersion ||
	wasm('jazz-wasm/package.json').version !== sdkVersion
)
	throw new Error('SDK/Wasm version mismatch')
json(join(directory, 'versions.json'), {
	...versions,
	jazz: installed('jazz-tools/package.json').version,
	wasm: wasm('jazz-wasm/package.json').version
})
run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.json'], app)
run('pnpm', ['exec', 'svelte-check', '--tsconfig', './tsconfig.json', '--fail-on-warnings'], app)
run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.worker-bindings.config.ts'], app)
checkFinanceWorker(directory, finance, proof)
console.log(`Finance ${sdkVersion} worker proof passed; artifacts retained at ${directory}`)
