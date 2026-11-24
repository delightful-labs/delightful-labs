import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Reuse the qualified Finance schema artifact. No workspace installs or generation.
const proof = dirname(fileURLToPath(import.meta.url))
if (!process.argv[2]) throw new Error('Pass a qualified Finance schema artifact directory')
const artifact = resolve(process.argv[2])
const clipper = process.argv[3] === '--clipper'
if (process.argv[3] !== undefined && !clipper) throw new Error('Unknown retained reader scope')
const schemaPath = clipper ? 'app/src/lib/backend/jazz' : 'app/src/lib'
const entry = clipper ? 'jazz.generated.ts' : 'queries.ts'
const identity = JSON.parse(readFileSync(join(artifact, 'schema-identity.json'), 'utf8'))
const tools = createRequire(join(artifact, 'app/package.json'))
const sdkVersion = tools('jazz-tools/package.json').version
assert.equal(
	JSON.parse(readFileSync(join(artifact, 'sdk-metadata.json'), 'utf8')).version,
	sdkVersion
)
assert.equal(sdkVersion, '2.0.0-beta.1')
assert.ok(identity[sdkVersion].schemas.some((schema) => schema.hash === identity.alpha60))
assert.deepEqual(identity[sdkVersion], identity['2.0.0-alpha.67'])
const sdk = createRequire(tools.resolve('jazz-tools/package.json'))
const { build } = sdk('esbuild')
const directory = mkdtempSync(join(tmpdir(), 'finance-retained-readers-'))
for (const [name, version] of [
	['alpha67', '2.0.0-alpha.67'],
	['beta1', sdkVersion]
]) {
	const path = join(directory, name)
	mkdirSync(path)
	writeFileSync(
		join(path, 'package.json'),
		JSON.stringify(
			{
				name: 'jazz-retained-reader',
				private: true,
				type: 'module',
				dependencies: {
					'jazz-tools': version,
					zod: tools('zod/package.json').version,
					ws: '8.22.1',
					'@opentelemetry/api': '1.9.1'
				},
				pnpm: { overrides: { '@opentelemetry/api': '1.9.1' } }
			},
			null,
			2
		) + '\n'
	)
	writeFileSync(join(path, '.npmrc'), 'auto-install-peers=false\n')
	writeFileSync(
		join(path, 'pnpm-workspace.yaml'),
		'supportedArchitectures:\n  os: [current, linux]\n  cpu: [current, x64]\n  libc: [glibc]\n'
	)
	execFileSync('pnpm', ['install', '--ignore-scripts'], { cwd: path, stdio: 'inherit' })
	// Both readers use the same current app. Historical alpha.60 production and
	// archive compatibility are qualified separately by the schema runner.
	const contents = `export { app } from ${JSON.stringify(join(artifact, schemaPath, entry))};\nexport { default as permissions } from ${JSON.stringify(join(artifact, schemaPath, 'jazz.permissions.json'))} with { type: 'json' };`
	await build({
		stdin: { contents, resolveDir: path },
		outfile: join(path, 'retained-schema.mjs'),
		bundle: true,
		packages: 'external',
		platform: 'node',
		format: 'esm'
	})
	for (const file of ['jazz.app.json', 'jazz.permissions.json'])
		copyFileSync(join(artifact, schemaPath, file), join(path, file))
	copyFileSync(join(proof, 'retained-read.mjs'), join(path, 'retained-read.mjs'))
}
copyFileSync(join(proof, 'retained-compare.mjs'), join(directory, 'retained-compare.mjs'))
execFileSync(
	'tar',
	[
		'--no-xattrs',
		'-czf',
		join(directory, 'readers.tgz'),
		'--exclude=*darwin*',
		'--exclude=*linux-arm64*',
		'--exclude=*musl*',
		'--exclude=*win32*',
		'--exclude=*.map',
		'alpha67',
		'beta1',
		'retained-compare.mjs'
	],
	{ cwd: directory, stdio: 'inherit' }
)
console.log(`Prepared native retained readers: ${directory}`)
