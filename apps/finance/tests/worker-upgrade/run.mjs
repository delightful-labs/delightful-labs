import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Upgrade experiment only: reuse the maintained Finance fixture in a disposable
// project, with its own dependencies. No workspace pin or installed SDK is edited.
const finance = fileURLToPath(new URL('../../', import.meta.url))
const proof = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(finance, 'package.json'))
const directory = mkdtempSync(join(tmpdir(), 'finance-jazz-alpha65-'))
console.log(`Upgrade proof artifacts: ${directory}`)
const run = (command, args, cwd = directory) =>
	execFileSync(command, args, { cwd, stdio: 'inherit' })
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const sdkVersion = '2.0.0-alpha.65'
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
run('git', ['apply', '--check', join(proof, 'worker-bridge.patch')], sdk)
run('git', ['apply', join(proof, 'worker-bridge.patch')], sdk)
run('tar', ['-czf', join(directory, 'candidate-sdk.tgz'), '-C', candidate, 'package'])

// Pack the current built public library without running generation/prepack hooks.
writeFileSync(
	join(directory, 'pack-library.log'),
	execFileSync(
		'pnpm',
		['pack', '--config.ignore-scripts=true', '--out', join(directory, 'local-first.tgz')],
		{ cwd: join(finance, '../../packages/local-first') }
	)
)
const app = join(directory, 'app')
mkdirSync(app)
for (const path of [
	'src/lib/schema.ts',
	'src/lib/schema',
	'src/lib/domain',
	'src/lib/validation',
	'src/lib/runtime/worker/account-store.ts',
	'tests/worker-bindings',
	'tooling/jazz-wasm.ts',
	'vitest.worker-bindings.config.ts'
]) {
	const target = join(app, path)
	mkdirSync(dirname(target), { recursive: true })
	cpSync(join(finance, path), target, { recursive: true })
}
run('git', ['apply', '--check', join(proof, 'fixture.patch')], app)
run('git', ['apply', join(proof, 'fixture.patch')], app)
const versions = Object.fromEntries(
	[
		'vite',
		'vitest',
		'@playwright/test',
		'typescript',
		'@types/node',
		'svelte',
		'xstate',
		'zod'
	].map((name) => [name, require(`${name}/package.json`).version])
)
// Match Finance's approved API pin rather than resolving a newer SDK peer.
const telemetry = JSON.parse(
	execFileSync('pnpm', ['list', '@opentelemetry/api', '--depth', '0', '--json'], {
		cwd: finance,
		encoding: 'utf8'
	})
)
versions['@opentelemetry/api'] = telemetry[0].dependencies['@opentelemetry/api'].version
json(join(app, 'package.json'), {
	name: 'finance-jazz-upgrade-proof',
	private: true,
	type: 'module',
	imports: { '#lib/*': './src/lib/*' },
	pnpm: { overrides: { '@opentelemetry/api': versions['@opentelemetry/api'] } },
	dependencies: {
		...versions,
		'jazz-tools': 'file:../candidate-sdk.tgz',
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
		noEmit: true,
		types: ['node', 'vite/client']
	},
	include: [
		'tests/worker-bindings/**/*.ts',
		'tooling/jazz-wasm.ts',
		'vitest.worker-bindings.config.ts'
	]
})
run('pnpm', ['install', '--ignore-scripts'], app)
// Compile the selected shared session adapters against alpha.65, then test their
// normal public package exports. Unrelated library code keeps its built output.
const library = join(finance, '../../packages/local-first')
const sources = join(app, 'session-adapters')
for (const path of [
	'src/lib/backend/jazz/recovery-phrase.ts',
	'src/lib/backend/jazz/restoration.ts',
	'src/lib/backend/jazz/session-readiness.ts',
	'src/lib/contracts/recovery-phrase.ts',
	'src/lib/contracts/restoration.ts',
	'src/lib/contracts/session.ts'
]) {
	mkdirSync(dirname(join(sources, path)), { recursive: true })
	cpSync(join(library, path), join(sources, path))
}
run('git', ['apply', '--check', join(proof, 'session-adapters.patch')], sources)
run('git', ['apply', join(proof, 'session-adapters.patch')], sources)
const adapted = join(directory, 'adapted-local-first')
mkdirSync(adapted)
run('tar', ['-xzf', join(directory, 'local-first.tgz'), '-C', adapted])
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
		'src/lib/backend/jazz/session-readiness.ts'
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
run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.worker-bindings.config.ts'], app)
console.log(`Upgrade proof passed; artifacts retained at ${directory}`)
