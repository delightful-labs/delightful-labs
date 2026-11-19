import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Pure source qualification: never constructs a store or calls Vercel.
const directory = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Pass an alpha.66 schema artifact directory')
const installed = createRequire(join(directory, 'app/package.json'))
const version = installed('jazz-tools/package.json').version
assert.equal(version, '2.0.0-alpha.66')
assert.equal(
	JSON.parse(readFileSync(join(directory, 'sdk-metadata.json'), 'utf8')).version,
	version
)
const sdk = dirname(installed.resolve('jazz-tools/package.json'))
const { coreName, driveName, perBranch, refuseVercelName } = await import(
	pathToFileURL(join(sdk, 'dist/backend/vercel-store.js'))
)
const project = 'prj_XRyQmkRAdDV2xUZGPeXcFBSfgHVa'
const destinations = [
	{ core: 'jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-production', namespace: 'production' },
	{
		core: 'jazz-prj-xryqmkraddv2xuzgpexcfbsfghva-preview-mono-d7de34b1',
		namespace: 'preview-mono-d7de34b1'
	}
]
const results = destinations.map(({ core, namespace }) => {
	const actual = coreName(project, namespace, {})
	assert.equal(actual.name, core)
	assert.equal(driveName(actual.name), `${core}-data`)
	return { core, namespace, sameCore: true, sameDrive: true }
})
assert.equal(perBranch('mono'), destinations[1].namespace)
const custom = 'finance-alpha60-preview-qualification'
assert.throws(
	() => refuseVercelName({ name: custom, credentials: { projectId: project } }),
	/no namespace reaches it any more/
)
writeFileSync(
	join(directory, 'vercel-name-qualification.json'),
	JSON.stringify(
		{
			version,
			project,
			results,
			custom: { core: custom, reachable: false },
			liveDataQualified: false,
			cloudCalls: 0
		},
		null,
		2
	) + '\n'
)
console.log(
	'Alpha.66 preserves both default destination names; custom qualification remains blocked'
)
