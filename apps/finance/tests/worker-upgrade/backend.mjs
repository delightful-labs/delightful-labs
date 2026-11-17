import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Reuse the generated Clipper schema proof and its exact dependency graph.
// No application pins, installed workspace packages or destinations are changed.
const proof = dirname(fileURLToPath(import.meta.url))
const workspace = resolve(proof, '../../../..')
const directory = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Pass the artifact directory from --clipper-schema')
const source = join(directory, 'app')
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
const run = (command, args, cwd = app) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const metadata = JSON.parse(readFileSync(join(directory, 'sdk-metadata.json'), 'utf8'))
assert.equal(metadata.version, '2.0.0-alpha.66')
const app = mkdtempSync(join(directory, 'backend-'))
cpSync(join(source, 'src'), join(app, 'src'), { recursive: true })
for (const name of ['package.json', 'pnpm-lock.yaml', '.npmrc', 'tsconfig.schema.json'])
	cpSync(join(source, name), join(app, name))
mkdirSync(join(app, 'tooling'))
cpSync(
	join(workspace, 'apps/clipper/tooling/extension-identity.ts'),
	join(app, 'tooling/extension-identity.ts')
)
run('git', ['apply', '--check', '--whitespace=error-all', join(proof, 'clipper-backend.patch')])
run('git', ['apply', join(proof, 'clipper-backend.patch')])
json(join(app, 'tsconfig.backend.json'), {
	extends: './tsconfig.schema.json',
	include: ['src/lib/server/gateway-auth.integration.test.ts']
})
writeFileSync(
	join(app, 'vitest.backend.config.mjs'),
	"import { defineConfig } from 'vitest/config'\n" +
		"export default defineConfig({ test: { include: ['src/lib/server/gateway-auth.integration.test.ts'], testTimeout: 15000, hookTimeout: 30000 } })\n"
)
run('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'])
const installed = createRequire(join(app, 'package.json'))
assert.equal(installed('jazz-tools/package.json').version, metadata.version)
const native = createRequire(installed.resolve('jazz-tools/package.json'))
const core = JSON.parse(
	readFileSync(join(dirname(native.resolve('jazz-napi')), 'package.json'), 'utf8')
)
assert.equal(core.version, metadata.version)
run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.backend.json'])
const testArgs = ['exec', 'vitest', 'run', '--config', 'vitest.backend.config.mjs']
function control(name, expected) {
	const result = spawnSync(
		'pnpm',
		[...testArgs, '--testNamePattern', 'admits signed registered guests'],
		{
			cwd: app,
			encoding: 'utf8'
		}
	)
	if (result.error) throw result.error
	const output = result.stdout + result.stderr
	writeFileSync(join(directory, `backend-${name}.log`), output)
	assert.equal(result.status, 1, `Unpatched ${name} control did not fail as expected`)
	assert.ok(output.includes(expected), `Unexpected ${name} failure; inspect its retained log`)
}
// An upstream fix must make us revisit the old patch, rather than silently keep it.
const test = join(app, 'src/lib/server/gateway-auth.integration.test.ts')
const original = readFileSync(test, 'utf8')
control('unpatched-origin', 'createJazz: allowedOrigins entry')
const origin = '\n\t\tallowedOrigins: [extensionOrigin]'
assert.equal(original.split(origin).length, 2)
writeFileSync(test, original.replace(origin, ''))
control('unpatched-account', 'expected 401 to be 200')
writeFileSync(test, original)

// Reuse only the existing backend file's two hunks, byte-for-byte. No new patch behavior.
const existing = readFileSync(join(workspace, 'patches/jazz-tools@2.0.0-alpha.60.patch'), 'utf8')
assert.ok(existing.startsWith('diff --git a/dist/backend/create-jazz.js'))
const backendPatch = existing.slice(0, existing.indexOf('\ndiff --git ', 1)) + '\n'
const patch = join(directory, 'backend-compatibility.patch')
writeFileSync(patch, backendPatch)
const sdk = join(directory, 'backend-sdk', 'package')
cpSync(join(directory, 'candidate/package'), sdk, { recursive: true })
run('git', ['apply', '--check', '--whitespace=error-all', patch], sdk)
run('git', ['apply', patch], sdk)
run('tar', ['-czf', join(directory, 'backend-sdk.tgz'), '-C', dirname(sdk), 'package'])
const manifest = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'))
manifest.dependencies['jazz-tools'] = 'file:../backend-sdk.tgz'
json(join(app, 'package.json'), manifest)
run('pnpm', ['install', '--offline', '--ignore-scripts'])
run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.backend.json'])
run('pnpm', testArgs)
json(join(directory, 'backend-qualification.json'), {
	sdkVersion: metadata.version,
	fixtureDirectory: app,
	existingBackendPatchSha256: createHash('sha256').update(backendPatch).digest('hex'),
	unpatchedControls: ['extension-origin-startup-refused', 'registered-device-account-refused'],
	patchedGatewayCases: 8,
	remaining: [
		'Better Auth/session expiry',
		'retained Vercel destinations',
		'full patch and consumer switch'
	]
})
console.log(`Native gateway qualification passed; artifacts retained at ${directory}`)
