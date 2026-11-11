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
	type ArchivePayload
} from 'delightful-local-first/backup/archive'
import {
	prepareArchiveOpen,
	prepareArchiveSeal,
	type ArchiveProtection
} from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import type { BackupBinding } from 'delightful-local-first/backup/binding'
import { createTestAppDataset } from './dataset.js'
import { testAppProfile } from './profile.js'

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
	test(`test app archive fixture retains independently inspected exact ${protection.kind} file`, async (t) => {
		const directory = await mkdtemp(join(tmpdir(), 'dlf-test-app-export-'))
		t.after(() => rm(directory, { recursive: true, force: true }))
		const path = join(directory, 'test-app.dlfbackup')
		const original = sample()
		const originalJson = JSON.stringify(original)
		const request = prepareArchiveSeal(original, protection)
		const actor = createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
		const sealed = await toPromise(actor)
		if (sealed.outcome !== 'sealed') throw new Error('Fixture sealing failed')
		const copy = sealed.archive.copyBytes()
		try {
			await writeFile(path, copy)
		} finally {
			copy.fill(0)
			sealed.archive.release()
			request.release()
		}
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
		assert.equal(JSON.stringify(original), originalJson)
	})
}

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
