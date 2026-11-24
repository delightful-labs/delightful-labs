import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

// Disposable-copy recovery rehearsal. Never open or overwrite the captured store.
const [readersArgument, snapshotsArgument, scope, kind, baseline = 'alpha67', ...extra] =
	process.argv.slice(2)
if (!readersArgument || !snapshotsArgument || !scope || !/^[a-zA-Z0-9_-]+$/.test(scope))
	throw new Error('Pass prepared readers, snapshot root, destination name and app kind')
if (kind !== 'finance' && kind !== 'clipper') throw new Error('Unknown recovery app kind')
if ((baseline !== 'alpha67' && baseline !== 'beta1') || extra.length)
	throw new Error('Recovery baseline must be alpha67 or beta1')
const readers = resolve(readersArgument)
const snapshots = resolve(snapshotsArgument)
const source = join(snapshots, scope)
const candidate = join(readers, 'beta1')
const sdk = createRequire(join(candidate, 'package.json'))
assert.equal(sdk('jazz-tools/package.json').version, '2.0.0-beta.1')
assert.equal(
	createRequire(join(readers, baseline, 'package.json'))('jazz-tools/package.json').version,
	baseline === 'alpha67' ? '2.0.0-alpha.67' : '2.0.0-beta.1'
)
const { createJazz, sqlite } = await import(pathToFileURL(sdk.resolve('jazz-tools/backend')))
const { app, permissions } = await import(pathToFileURL(join(candidate, 'retained-schema.mjs')))
async function fingerprint(path) {
	const entries = []
	for (const entry of await readdir(path, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) throw new Error('Snapshot contains an unsupported symbolic link')
		const file = join(path, entry.name)
		entries.push([
			entry.name,
			entry.isDirectory()
				? await fingerprint(file)
				: createHash('sha256')
						.update(await readFile(file))
						.digest('hex')
		])
	}
	return entries.sort((a, b) => a[0].localeCompare(b[0]))
}
const original = await fingerprint(source)
const work = await mkdtemp(join(snapshots, 'recovery-'))
const key = join(work, 'key')
await writeFile(key, randomBytes(32), { mode: 0o600 })
function read(version, snapshot, name) {
	const output = join(work, name + '.json')
	try {
		execFileSync(
			process.execPath,
			[join(readers, version, 'retained-read.mjs'), snapshot, join(work, name), output, key],
			{ stdio: 'pipe', timeout: 60000 }
		)
	} catch {
		throw new Error('Recovery reader refused: ' + name)
	}
	return readFile(output, 'utf8').then(JSON.parse)
}
try {
	process.chdir(candidate)
	process.env.JAZZ_APP_DIR = candidate
	const before = await read(baseline, source, 'baseline')
	const candidateBefore = await read('beta1', source, 'candidate-before-write')
	assert.equal(before.identityPreserved, true)
	assert.equal(candidateBefore.identityPreserved, true)
	assert.equal(typeof before.appIdProof, 'string')
	assert.ok(candidateBefore.appIdProof === before.appIdProof, 'Candidate identity differs')
	assert.ok(isDeepStrictEqual(candidateBefore.tables, before.tables), 'Candidate data differs')
	const upgraded = join(work, 'upgraded-source')
	await mkdir(upgraded)
	await cp(join(source, 'store'), join(upgraded, 'store'), { recursive: true })
	await copyFile(join(source, 'app-id'), join(upgraded, 'app-id'))
	const mode = await readFile(join(upgraded, 'store/blob-store'), 'utf8')
		.then((value) => value.trim())
		.catch((error) => {
			if (error.code === 'ENOENT') return 'sqlite'
			throw error
		})
	if (mode !== 'files' && mode !== 'sqlite') throw new Error('Unsupported recovery blob layout')
	const backend = createJazz({
		app,
		permissions,
		store: sqlite({
			path: join(upgraded, 'store'),
			...(mode === 'sqlite' ? { blobs: 'sqlite' } : {})
		})
	})
	const probe = crypto.randomUUID()
	const table = kind === 'finance' ? 'profiles' : 'libraries'
	try {
		await backend.ready()
		assert.equal(backend.appId, (await readFile(join(source, 'app-id'), 'utf8')).trim())
		const fields =
			kind === 'finance'
				? { userId: probe, displayName: 'Disposable recovery probe' }
				: { ownerId: probe, bootstrapVersion: '1' }
		await backend.db.insert(app[table], fields, { id: probe }).wait({ tier: 'global' })
		assert.ok(await backend.db.one(app[table].where({ id: probe })))
	} finally {
		await backend.close()
	}
	const changed = await read('beta1', upgraded, 'candidate-reopened')
	assert.equal(
		changed.tables.find((item) => item.name === table).rows,
		before.tables.find((item) => item.name === table).rows + 1
	)
	// Restore a fresh copy of the untouched snapshot, rather than trying an older
	// core against the upgraded directory or treating deployment promotion as undo.
	const restored = await read(baseline, source, 'restored-from-snapshot')
	assert.equal(restored.identityPreserved, true)
	assert.ok(restored.appIdProof === before.appIdProof, 'Restored identity differs')
	assert.ok(isDeepStrictEqual(restored.tables, before.tables), 'Restored data differs')
	assert.ok(isDeepStrictEqual(await fingerprint(source), original), 'Snapshot bytes changed')
	console.log(
		JSON.stringify({
			scope,
			baselineVersion: before.version,
			candidateVersion: candidateBefore.version,
			candidateIdentityAndAllRowsAuditBytesMatch: true,
			candidateWriteSurvivedReopen: true,
			restoredIdentityAndAllRowsAuditBytesMatch: true,
			snapshotBytesUnchanged: true
		})
	)
} finally {
	await rm(work, { recursive: true, force: true })
}
