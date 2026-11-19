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
const identity = JSON.parse(readFileSync(join(artifact, 'schema-identity.json'), 'utf8'))
const tools = createRequire(join(artifact, 'app/package.json'))
const sdkVersion = tools('jazz-tools/package.json').version
assert.equal(
	JSON.parse(readFileSync(join(artifact, 'sdk-metadata.json'), 'utf8')).version,
	sdkVersion
)
assert.equal(identity.alpha60, identity[sdkVersion.replace('2.0.0-alpha.', 'alpha')].current)
const sdk = createRequire(tools.resolve('jazz-tools/package.json'))
const { build } = sdk('esbuild')
const directory = mkdtempSync(join(tmpdir(), 'finance-retained-readers-'))
for (const version of ['60', '66', '67']) {
	const path = join(directory, 'alpha' + version)
	mkdirSync(path)
	writeFileSync(
		join(path, 'package.json'),
		JSON.stringify(
			{
				name: 'finance-retained-reader',
				private: true,
				type: 'module',
				dependencies: {
					'jazz-tools': '2.0.0-alpha.' + version,
					zod: '4.1.11',
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
	const contents =
		version === '60'
			? `export { app } from ${JSON.stringify(join(artifact, 'legacy/retained-schema.mjs'))};\nexport { default as permissions } from ${JSON.stringify(join(artifact, 'legacy/retained-permissions.mjs'))};`
			: `export { app } from ${JSON.stringify(join(artifact, 'app/src/lib/queries.ts'))};\nexport { default as permissions } from ${JSON.stringify(join(artifact, 'app/src/lib/jazz.permissions.json'))} with { type: 'json' };`
	await build({
		stdin: { contents, resolveDir: path },
		outfile: join(path, 'retained-schema.mjs'),
		bundle: true,
		packages: 'external',
		platform: 'node',
		format: 'esm'
	})
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
		'alpha60',
		'alpha66',
		'alpha67',
		'retained-compare.mjs'
	],
	{ cwd: directory, stdio: 'inherit' }
)
console.log(`Prepared native retained readers: ${directory}`)
