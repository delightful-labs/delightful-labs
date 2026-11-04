import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, appendFile, truncate, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileSource } from './io.mjs'
import { Readable } from 'node:stream'
import { createActor, toPromise, waitFor } from 'xstate'
import { boundedReadMachine } from './machines/read.mjs'

const vector = JSON.parse(await readFile('tests/fixtures/archive-envelope-v1.json', 'utf8'))
const directory = await mkdtemp(join(tmpdir(), 'dlf-reader-'))
after(() => rm(directory, { recursive: true, force: true }))
const encryptedPath = join(directory, 'encrypted.dlfbackup')
const plainPath = join(directory, 'plain.dlfbackup')
const plain = JSON.stringify({
	magic: 'DLF-BACKUP',
	version: 1,
	protection: 'none',
	payload: vector.payloadBase64,
	sha256: vector.payloadSha256
})
await writeFile(encryptedPath, JSON.stringify(vector.envelope))
await writeFile(plainPath, plain)

/**
 * @param {string[]} args
 * @param {string | Uint8Array} [input]
 * @param {'SIGINT' | 'SIGTERM'} [signal]
 * @returns {Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }>}
 */
function execute(args, input, signal) {
	return new Promise((done, reject) => {
		const child = spawn(
			process.execPath,
			[
				'--import',
				resolve('fixtures/backup-reader/no-network.mjs'),
				resolve('fixtures/backup-reader/inspect.mjs'),
				...args
			],
			{
				env: { PATH: process.env.PATH ?? '' },
				stdio: signal ? ['pipe', 'pipe', 'pipe', 'ipc'] : ['pipe', 'pipe', 'pipe']
			}
		)
		let stdout = '',
			stderr = ''
		const timeout = setTimeout(() => {
			child.kill('SIGKILL')
			reject(new Error('Reader did not exit'))
		}, 15000)
		child.stdout?.on('data', (chunk) => {
			stdout += String(chunk)
		})
		child.stderr?.on('data', (chunk) => {
			stderr += String(chunk)
		})
		child.once('error', (error) => {
			clearTimeout(timeout)
			reject(error)
		})
		child.once('close', (code, exitSignal) => {
			clearTimeout(timeout)
			done({ code, signal: exitSignal, stdout, stderr })
		})
		child.stdin?.on('error', () => {})
		if (signal)
			child.on('message', (message) => {
				if (message === 'passwordReady') child.kill(signal)
			})
		else child.stdin?.end(input)
	})
}

test('reads a retained plaintext file without network/app credentials and preserves file contents', async () => {
	const result = await execute([plainPath])
	assert.equal(result.code, 0)
	assert.equal(result.stderr, '')
	const report = JSON.parse(result.stdout)
	assert.equal(report.outcome, 'integrityValidProfileUnsupported')
	assert.equal(report.summary.profile.id, 'vector.notes')
	assert.equal(report.summary.payloadSha256, vector.payloadSha256)
	assert.equal(await readFile(plainPath, 'utf8'), plain)
})
test('requests a password independently of login and opens with exact stdin bytes', async () => {
	const required = await execute([encryptedPath], vector.password)
	assert.equal(required.code, 2)
	assert.deepEqual(JSON.parse(required.stdout), { outcome: 'passwordRequired' })
	const result = await execute([encryptedPath, '--password-stdin'], vector.password)
	assert.equal(result.code, 0)
	assert.equal(result.stderr, '')
	assert.equal(JSON.parse(result.stdout).outcome, 'integrityValidProfileUnsupported')
	assert.ok(!result.stdout.includes(vector.password))
})
test('does not strip password newlines, expose invalid UTF-8 or accept oversized stdin', async () => {
	for (const input of [
		vector.password + '\n',
		'',
		new Uint8Array([0xc0, 0xaf]),
		'x'.repeat(1025)
	]) {
		const result = await execute([encryptedPath, '--password-stdin'], input)
		assert.equal(result.code, 1)
		assert.equal(result.stderr, '')
		assert.equal(JSON.parse(result.stdout).outcome, 'failed')
		assert.ok(!result.stdout.includes(vector.password))
	}
})
test('rejects corrupt/truncated files and sanitizes missing-file paths', async () => {
	const path = join(directory, 'broken.dlfbackup')
	await writeFile(path, '{"magic":')
	const broken = await execute([path])
	assert.equal(broken.code, 1)
	assert.equal(broken.stderr, '')
	const missing = await execute([join(directory, 'private-path-sentinel')])
	assert.equal(missing.code, 1)
	assert.equal(missing.stderr, '')
	assert.deepEqual(JSON.parse(missing.stdout), { outcome: 'failed', code: 'fileReadFailed' })
	assert.ok(!missing.stdout.includes('private-path-sentinel'))
})
test('enforces a bounded range read without an unbounded stat/readFile window', async () => {
	const bytes = await fileSource(plainPath).read(
		new AbortController().signal,
		Buffer.byteLength(plain)
	)
	assert.equal(Buffer.from(bytes).toString(), plain)
	bytes.fill(0)
	await assert.rejects(fileSource(plainPath).read(new AbortController().signal, 8), {
		code: 'limitExceeded'
	})
	const controller = new AbortController()
	controller.abort()
	await assert.rejects(fileSource(plainPath).read(controller.signal, 100), {
		code: 'fileReadFailed'
	})
})
test('keeps a concurrent file growth read inside its byte budget', async () => {
	const path = join(directory, 'growing.dlfbackup')
	await writeFile(path, Buffer.alloc(16, 1))
	const reading = fileSource(path)
		.read(new AbortController().signal, 32)
		.then(
			(bytes) => ({ bytes }),
			(error) => ({ error })
		)
	await appendFile(path, Buffer.alloc(65536, 2))
	const result = await reading
	if ('bytes' in result) {
		assert.ok(result.bytes.length <= 32)
		result.bytes.fill(0)
	} else assert.equal(result.error.code, 'limitExceeded')
})
test('rejects a file beyond the public outer limit', async () => {
	const path = join(directory, 'oversized.dlfbackup')
	await writeFile(path, '')
	await truncate(path, 64 * 1024 * 1024 + 1)
	const result = await execute([path])
	assert.equal(result.code, 1)
	assert.equal(result.stderr, '')
	assert.deepEqual(JSON.parse(result.stdout), { outcome: 'failed', code: 'limitExceeded' })
})
test('rejects altered plain payload hashes', async () => {
	const path = join(directory, 'corrupt.dlfbackup')
	await writeFile(
		path,
		JSON.stringify({
			magic: 'DLF-BACKUP',
			version: 1,
			protection: 'none',
			payload: vector.payloadBase64,
			sha256: createHash('sha256').update('wrong').digest('hex')
		})
	)
	const result = await execute([path])
	assert.equal(result.code, 1)
	assert.deepEqual(JSON.parse(result.stdout), { outcome: 'failed', code: 'integrityMismatch' })
})
for (const signal of ['SIGINT', 'SIGTERM'])
	test(`drains ${signal} while password stdin is waiting`, async () => {
		const selected = signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM'
		const result = await execute([encryptedPath, '--password-stdin'], undefined, selected)
		assert.equal(result.code, 1)
		assert.equal(result.signal, null)
		assert.equal(result.stderr, '')
		assert.deepEqual(JSON.parse(result.stdout), {
			outcome: selected === 'SIGINT' ? 'cancelled' : 'closed'
		})
	})
test('rejects extra arguments without echoing them', async () => {
	const result = await execute([encryptedPath, '--password', 'private-secret-argument'])
	assert.equal(result.code, 1)
	assert.equal(JSON.parse(result.stdout).code, 'usage')
	assert.ok(!result.stdout.includes('private-secret-argument'))
})

// Direct stream-owner checks supplement the real file/subprocess cases above.
/** @param {boolean} waitForClose @param {number} [maximum] */
function streamOwner(waitForClose, maximum = 4) {
	const stream = new Readable({ read() {}, autoDestroy: false, emitClose: false })
	const controller = new AbortController()
	/** @type {import('./stream-native.mjs').ReadStorage} */
	const storage = { chunks: [], bytes: undefined }
	const actor = createActor(boundedReadMachine, {
		input: { stream, maximum, signal: controller.signal, waitForClose, storage }
	}).start()
	return { stream, controller, storage, actor }
}
test('file EOF waits for descriptor close, then transfers copied bytes and removes listeners', async () => {
	const f = streamOwner(true),
		chunk = Uint8Array.of(1, 2)
	f.stream.emit('data', chunk)
	f.stream.emit('end')
	assert.equal(f.actor.getSnapshot().status, 'active')
	f.stream.emit('close')
	const result = await toPromise(f.actor)
	assert.equal(result.outcome, 'read')
	if (result.outcome !== 'read') throw new Error('Expected read')
	assert.deepEqual(result.bytes, Uint8Array.of(1, 2))
	assert.deepEqual(chunk, Uint8Array.of(0, 0))
	assert.equal(f.storage.chunks.length, 0)
	for (const event of ['data', 'end', 'error', 'close'])
		assert.equal(f.stream.listenerCount(event), 0)
})
test('stdin completes at EOF without waiting for close or destroying the host stream', async () => {
	const f = streamOwner(false)
	f.stream.emit('data', Uint8Array.of(1))
	f.stream.emit('end')
	assert.equal((await toPromise(f.actor)).outcome, 'read')
	assert.equal(f.stream.destroyed, false)
	f.stream.destroy()
})
test('premature close rejects partial data and clears it', async () => {
	const f = streamOwner(true),
		chunk = Uint8Array.of(1)
	f.stream.emit('data', chunk)
	f.stream.emit('close')
	assert.deepEqual(await toPromise(f.actor), { outcome: 'failed', code: 'fileReadFailed' })
	assert.equal(chunk[0], 0)
})
test('file errors wait for close and discard late data', async () => {
	const f = streamOwner(true),
		late = Uint8Array.of(3)
	f.stream.emit('error', new Error('private read failure'))
	f.stream.emit('data', late)
	assert.equal(f.actor.getSnapshot().status, 'active')
	assert.equal(late[0], 0)
	f.stream.emit('close')
	assert.deepEqual(await toPromise(f.actor), { outcome: 'failed', code: 'fileReadFailed' })
})
test('abort after file EOF destroys and waits for native close before failure', async () => {
	const f = streamOwner(true)
	f.stream.emit('end')
	f.controller.abort()
	await waitFor(f.actor, (s) => s.matches({ active: 'awaitingFailureClose' }))
	assert.equal(f.stream.destroyed, true)
	assert.equal(f.actor.getSnapshot().status, 'active')
	f.stream.emit('close')
	assert.deepEqual(await toPromise(f.actor), { outcome: 'failed', code: 'fileReadFailed' })
})
test('oversize stdin is destroyed, reports the bound failure, and clears all chunks', async () => {
	const f = streamOwner(false, 1),
		first = Uint8Array.of(1),
		extra = Uint8Array.of(2)
	f.stream.emit('data', first)
	f.stream.emit('data', extra)
	assert.deepEqual(await toPromise(f.actor), { outcome: 'failed', code: 'limitExceeded' })
	assert.equal(f.stream.destroyed, true)
	assert.equal(first[0], 0)
	assert.equal(extra[0], 0)
})
