import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { createActor, toPromise } from 'xstate'
import {
	encodeArchivePayload,
	parseArchivePayload,
	payloadLimits,
	type ArchivePayload
} from 'delightful-local-first/backup/archive'
import { prepareArchiveOpen, type ArchiveProtection } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import {
	prepareArchiveExport,
	type ArchiveHandoffObservation,
	type BackupBinding
} from 'delightful-local-first/backup/export'
import {
	createArchiveExportMachine,
	createArchiveExportCleanupMachine
} from 'delightful-local-first/backup/export/workflow'
import { createTestAppExport } from './export.js'
import { createTestAppDataset } from './dataset.js'
import { testAppProfile } from './profile.js'
import { createTestAppSource } from './source.js'

const binding: BackupBinding = Object.freeze({
	applicationId: 'test-app-fixture',
	environment: 'disposable',
	identityId: 'owner',
	workspaceId: 'source',
	generation: 1,
	operationId: 'test-app-export'
})
function sample() {
	return createTestAppDataset({
		applicationId: binding.applicationId,
		workspaceId: binding.workspaceId
	})
}
function canonical(payload: unknown) {
	return parseArchivePayload(encodeArchivePayload(payload))
}

const independentInspector = `
import { createActor, toPromise } from 'xstate'
import { prepareArchiveInspection } from 'delightful-local-first/backup/inspection'
import { createArchiveInspectionMachine } from 'delightful-local-first/backup/inspection/workflow'
import { fileSource, stdinPassword } from './fixtures/backup-reader/io.mjs'
import { testAppProfile } from './.svelte-kit/test-app/profile.js'
const actor = createActor(createArchiveInspectionMachine(), { input: {
  request: prepareArchiveInspection({ source: fileSource(process.argv[1]), password: stdinPassword(), profiles: [testAppProfile] })
} })
actor.start()
const result = await toPromise(actor)
if ('report' in result) {
  process.stdout.write(JSON.stringify({ outcome: result.outcome, summary: result.report.readSummary() }))
  result.report.release()
} else {
  process.stdout.write(JSON.stringify(result))
  process.exitCode = 1
}
`

const protections: ArchiveProtection[] = [
	{ kind: 'none' },
	{ kind: 'password', password: ' exact retained-file password-é😀 ' }
]
for (const protection of protections) {
	test(`public test app export retains independently inspected exact ${protection.kind} file`, async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'dlf-test-app-export-'))
		t.after(() => rm(directory, { recursive: true, force: true }))
		const path = join(directory, 'test-app.dlfbackup')
		let writtenCopy: Uint8Array | undefined
		const { actor, request, source } = createTestAppExport({
			binding,
			protection,
			handoff: {
				dispatch: (file, expected, signal) => {
					assert.deepEqual(expected, binding)
					assert.equal(signal.aborted, false)
					const copy = file.copyBytes()
					writtenCopy = copy
					return writeFile(path, copy, { signal })
						.then((): ArchiveHandoffObservation => 'dispatched')
						.finally(() => copy.fill(0))
				}
			}
		})
		t.after(() => source.actor.stop())
		actor.start()
		assert.deepEqual(await toPromise(actor), {
			outcome: 'exported',
			binding,
			archiveProduced: true,
			handoff: 'dispatched'
		})
		assert.ok(writtenCopy?.every((byte) => byte === 0))
		const retained = await readFile(path)
		const independent = spawnSync(
			process.execPath,
			[
				'--import',
				resolve('fixtures/backup-reader/no-network.mjs'),
				'--input-type=module',
				'--eval',
				independentInspector,
				path
			],
			{
				env: { PATH: process.env.PATH ?? '' },
				input: protection.kind === 'password' ? protection.password : '',
				encoding: 'utf8',
				timeout: 15000
			}
		)
		assert.equal(independent.error, undefined)
		assert.equal(independent.status, 0, independent.stderr)
		assert.equal(independent.stderr, '')
		assert.match(independent.stdout, /"outcome":"profileValid"/)
		assert.match(independent.stdout, /"records":4/)
		assert.match(independent.stdout, /"attachments":1/)
		assert.ok(!independent.stdout.includes('First line'))
		const opening = createActor(createArchiveEnvelopeMachine(), {
			input: {
				request: prepareArchiveOpen(
					retained,
					protection.kind === 'password' ? protection.password : undefined
				)
			}
		})
		opening.start()
		const opened = await toPromise(opening)
		assert.equal(opened.outcome, 'integrityChecked')
		if (opened.outcome !== 'integrityChecked') throw new Error('Checked archive required')
		try {
			const contents = opened.archive.readPayload(),
				expected = canonical(sample())
			assert.deepEqual(contents.records, expected.records)
			assert.deepEqual(contents.attachments, expected.attachments)
			assert.deepEqual(contents.coverage, expected.coverage)
			assert.deepEqual(contents.source, expected.source)
			assert.deepEqual(contents.profile, expected.profile)
			assert.deepEqual(contents.references, [])
			assert.match(independent.stdout, new RegExp(opened.archive.payloadDigest()))
		} finally {
			opened.archive.release()
		}
		assert.deepEqual(await readFile(path), retained)
		const signal = new AbortController().signal
		const lease = await source.acquire(binding, signal)
		try {
			const current = canonical(await lease.read(signal, payloadLimits))
			assert.deepEqual(current.records, canonical(sample()).records)
			assert.deepEqual(current.attachments, canonical(sample()).attachments)
		} finally {
			await lease.release()
		}
		request.release()
	})
}

test('test app capture lease excludes writers and other owners, releases idempotently and bounds reads', async (t) => {
	const source = createTestAppSource(sample(), binding),
		signal = new AbortController().signal
	source.actor.start()
	t.after(() => source.actor.stop())
	const lease = await source.acquire(binding, signal)
	assert.throws(() => source.replace(sample()))
	assert.throws(() => source.acquire(binding, signal))
	try {
		await lease.drain(signal)
		const first = canonical(await lease.read(signal, payloadLimits))
		const second = canonical(await lease.read(signal, payloadLimits))
		assert.notEqual(first.archiveId, second.archiveId)
		assert.deepEqual(first.records, second.records)
		assert.equal(Object.isFrozen(first.records), true)
		assert.throws(() => lease.read(signal, { ...payloadLimits, payloadBytes: 1 }), {
			code: 'limitExceeded'
		})
		source.observeBinding({ ...binding, generation: binding.generation + 2 })
		assert.equal(await lease.checkConsistency(signal), false)
		assert.throws(() => lease.read(signal, payloadLimits))
	} finally {
		await lease.release()
	}
	await lease.release()
	source.observeBinding(binding)
	source.replace(sample())
	const replacement = await source.acquire(binding, signal)
	await lease.release() // old cleanup must not release a newer lease
	assert.throws(() => source.replace(sample()))
	await replacement.release()
	const aborted = new AbortController()
	aborted.abort()
	assert.equal(await source.checkAuthority(binding, aborted.signal), false)
	assert.throws(() => source.acquire(binding, aborted.signal))
})

test('test app validator accepts an empty book, shared attachments and archived/empty notes', () => {
	assert.equal(testAppProfile.validate(canonical(sample())), true)
	const payload = sample()
	assert.equal(
		testAppProfile.validate(
			canonical({
				...payload,
				records: payload.records.filter((record) => record.type === 'notebook'),
				attachments: []
			})
		),
		true
	)
})

const invalidProfiles: { name: string; change: (payload: ArchivePayload) => ArchivePayload }[] = [
	{ name: 'unsupported version', change: (p) => ({ ...p, profile: { ...p.profile, version: 2 } }) },
	{ name: 'foreign profile', change: (p) => ({ ...p, profile: { ...p.profile, id: 'foreign' } }) },
	{ name: 'no notebook', change: (p) => ({ ...p, records: [], attachments: [] }) },
	{
		name: 'second notebook',
		change: (p) => ({
			...p,
			records: [
				...p.records,
				{ type: 'notebook', id: 'second', fields: { title: { kind: 'text', value: 'second' } } }
			]
		})
	},
	{
		name: 'unknown field',
		change: (p) => ({
			...p,
			records: p.records.map((record) => ({
				...record,
				fields: { ...record.fields, unexpected: { kind: 'text', value: 'extra' } }
			}))
		})
	},
	{
		name: 'wrong relationship type',
		change: (p) => ({
			...p,
			records: p.records.map((record) =>
				record.type === 'note'
					? {
							...record,
							fields: {
								...record.fields,
								notebook: { kind: 'reference', type: 'note', id: 'first' }
							}
						}
					: record
			)
		})
	},
	{
		name: 'orphan file',
		change: (p) => ({
			...p,
			records: p.records.map((record) =>
				record.type === 'note'
					? { ...record, fields: { ...record.fields, attachment: { kind: 'null' } } }
					: record
			)
		})
	},
	{
		name: 'inert records',
		change: (p) => ({ ...p, references: [{ type: 'note', id: 'inert', fields: {} }] })
	},
	{
		name: 'unknown domain type',
		change: (p) => ({
			...p,
			coverage: { ...p.coverage, recordTypes: [...p.coverage.recordTypes, 'foreign'] },
			records: [...p.records, { type: 'foreign', id: 'foreign', fields: {} }]
		})
	}
]
for (const { name, change } of invalidProfiles)
	test(`test app rejects generically valid ${name}`, () =>
		assert.equal(testAppProfile.validate(canonical(change(sample()))), false))

test('public cleanup machine releases the retained test app lease without replaying export', async (t) => {
	const source = createTestAppSource(sample(), binding)
	source.actor.start()
	t.after(() => source.actor.stop())
	let releases = 0
	let dispatches = 0
	const request = prepareArchiveExport({
		binding,
		profile: testAppProfile,
		protection: { kind: 'none' },
		source: {
			checkAuthority: (expected, signal) => source.checkAuthority(expected, signal),
			acquire: (expected, signal) =>
				source.acquire(expected, signal).then((lease) => ({
					...lease,
					release() {
						releases += 1
						if (releases === 1) return Promise.reject(new Error('disposable release failure'))
						return lease.release()
					}
				}))
		},
		handoff: {
			dispatch() {
				dispatches += 1
				return Promise.resolve<ArchiveHandoffObservation>('dispatched')
			}
		}
	})
	const exporting = createActor(createArchiveExportMachine(), { input: { request } })
	exporting.start()
	const result = await toPromise(exporting)
	assert.equal(result.outcome, 'failed')
	if (result.outcome !== 'failed') throw new Error('Expected retained lease failure')
	assert.equal(result.code, 'captureCleanupFailed')
	assert.throws(() => source.replace(sample()), /capture owns/)
	const cleanup = createActor(createArchiveExportCleanupMachine(), { input: { request } })
	cleanup.start()
	assert.deepEqual(await toPromise(cleanup), { outcome: 'cleaned' })
	source.replace(sample())
	assert.equal(releases, 2)
	assert.equal(dispatches, 0)
})

test('source startup rejects early work without queuing it for later', async (t) => {
	const original = sample()
	const source = createTestAppSource(original, binding)
	t.after(() => source.actor.stop())
	const signal = new AbortController().signal
	assert.equal(await source.checkAuthority(binding, signal), false)
	assert.throws(() => source.acquire(binding, signal), /unavailable/)
	assert.throws(() => source.replace({ invalid: true }), /unavailable/)
	source.actor.start()
	const lease = await source.acquire(binding, signal)
	assert.deepEqual(
		canonical(await lease.read(signal, payloadLimits)).records,
		canonical(original).records
	)
	await lease.release()
})

test('binding replacement invalidates an existing lease even after A to B to A', async (t) => {
	const source = createTestAppSource(sample(), binding)
	source.actor.start()
	t.after(() => source.actor.stop())
	const signal = new AbortController().signal
	const lease = await source.acquire(binding, signal)
	source.observeBinding({ ...binding, generation: binding.generation + 1 })
	source.observeBinding(binding)
	assert.equal(source.actor.getSnapshot().matches({ leased: 'invalidated' }), true)
	assert.equal(await lease.checkConsistency(signal), false)
	assert.throws(() => lease.drain(signal), /invalidated/)
	assert.throws(() => lease.read(signal, payloadLimits), /invalidated/)
	assert.throws(() => source.replace(sample()), /capture owns/)
	await lease.release()
	const next = await source.acquire(binding, signal)
	assert.equal(await next.checkConsistency(signal), true)
	await lease.release()
	assert.throws(() => source.replace(sample()), /capture owns/)
	await next.release()
	source.replace(sample())
})

test('invalid writes preserve source contents and keep payloads out of source snapshots', async (t) => {
	const original = sample()
	const source = createTestAppSource(original, binding)
	source.actor.start()
	t.after(() => source.actor.stop())
	const snapshots: string[] = []
	source.actor.subscribe(() => snapshots.push(JSON.stringify(source.actor.getPersistedSnapshot())))
	assert.throws(() => source.replace({ private: 'rejected-private-payload' }))
	assert.equal(source.actor.getSnapshot().status, 'active')
	const signal = new AbortController().signal
	const lease = await source.acquire(binding, signal)
	assert.deepEqual(
		canonical(await lease.read(signal, payloadLimits)).records,
		canonical(original).records
	)
	await lease.release()
	for (const snapshot of snapshots) {
		assert.equal(snapshot.includes('Preserve archived content'), false)
		assert.equal(snapshot.includes('bytes.bin'), false)
		assert.equal(snapshot.includes('rejected-private-payload'), false)
	}
})

test('stopped source rejects work and old lease release remains harmless', async () => {
	const source = createTestAppSource(sample(), binding)
	source.actor.start()
	const signal = new AbortController().signal
	const lease = await source.acquire(binding, signal)
	source.actor.stop()
	assert.equal(await source.checkAuthority(binding, signal), false)
	assert.equal(await lease.checkConsistency(signal), false)
	assert.throws(() => lease.read(signal, payloadLimits), /unavailable/)
	assert.throws(() => source.replace(sample()), /unavailable/)
	await lease.release()
	await lease.release()
})
