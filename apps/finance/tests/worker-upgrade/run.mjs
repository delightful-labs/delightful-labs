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
const sdkVersion = '2.0.0-beta.1'
if (selectedVersion !== undefined && selectedVersion !== sdkVersion)
	throw new Error(`The maintained candidate is jazz-tools@${sdkVersion}`)
const directory = mkdtempSync(join(tmpdir(), `finance-jazz-${sdkVersion.replace('2.0.0-', '')}-`))
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
	const patch = join(finance, '../../patches', `jazz-tools@${sdkVersion}.patch`)
	run('git', ['apply', '--check', '--whitespace=error-all', patch], sdk)
	run('git', ['apply', patch], sdk)
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
	'@faker-js/faker',
	'better-auth',
	'@kingironman2011/better-auth-bsky',
	'layerchart',
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
json(join(app, 'package.json'), {
	name: 'finance-jazz-upgrade-proof',
	private: true,
	type: 'module',
	imports: { '#lib/*': './src/lib/*' },
	pnpm: {
		overrides: { '@opentelemetry/api': versions['@opentelemetry/api'] },
		patchedDependencies: {
			'@kingironman2011/better-auth-bsky@0.3.2': '../provider.patch'
		},
		// Match the root's missing-peer declarations for existing chart utilities.
		packageExtensions: {
			'@layerstack/utils@2.0.0-next.19': { peerDependencies: { svelte: '^5.0.0' } },
			'@layerstack/svelte-state@0.1.0-next.25': { peerDependencies: { svelte: '^5.0.0' } },
			'@layerstack/svelte-actions@1.0.1-next.20': { peerDependencies: { svelte: '^5.0.0' } }
		}
	},
	dependencies: {
		...versions,
		'jazz-tools': 'file:../candidate-sdk.tgz',
		'delightful-ui': 'file:../ui.tgz',
		'delightful-local-first': 'file:../local-first.tgz'
	}
})
cpSync(
	join(finance, '../clipper/patches/better-auth-bsky-0.3.2-better-auth-1.7.patch'),
	join(directory, 'provider.patch')
)
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
// Use the same maintained, packed Local First exports as both applications.
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
