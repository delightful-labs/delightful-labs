import { createHmac } from 'node:crypto'
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { app, permissions } from './retained-schema.mjs'

// Test-only reader. It opens only a newly copied directory, never the snapshot.
const [source, scratch, output, keyFile] = process.argv.slice(2)
if (!source || !scratch || !output || !keyFile) throw new Error('Missing retained reader paths')
const require = createRequire(import.meta.url)
const version = require('jazz-tools/package.json').version
const native = createRequire(require.resolve('jazz-tools/package.json'))
const nativeVersion = JSON.parse(
	await readFile(join(dirname(native.resolve('jazz-napi')), 'package.json'), 'utf8')
).version
if (version !== nativeVersion) throw new Error('SDK/native version mismatch')
const key = await readFile(keyFile)
const digest = (text) => createHmac('sha256', key).update(text).digest('hex')
function plain(value) {
	if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('base64') }
	if (value instanceof Date) return { date: value.toISOString() }
	if (typeof value === 'bigint') return { bigint: String(value) }
	if (Array.isArray(value)) return value.map(plain)
	if (value !== null && typeof value === 'object')
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((name) => [name, plain(value[name])])
		)
	return value
}
await mkdir(scratch) // Refuse an existing destination; never reuse an opened store.
await cp(join(source, 'store'), scratch, { recursive: true })
await copyFile(join(source, 'app-id'), join(scratch, 'app-id'))
const appId = (await readFile(join(source, 'app-id'), 'utf8')).trim()
if (!appId) throw new Error('Missing retained app identity')
const jazz = createJazz({ app, permissions, store: sqlite({ path: scratch, blobs: 'sqlite' }) })
try {
	await jazz.ready()
	if (jazz.appId !== appId) throw new Error('Retained app identity changed')
	const tables = []
	for (const name of Object.keys(app.wasmSchema)) {
		const query = app[name].select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt')
		const rows = await jazz.db.all(query)
		const encoded = rows.map((row) => JSON.stringify(plain(row))).sort()
		let byteCells = 0,
			byteLength = 0
		const bytes = []
		for (const row of rows)
			for (const [column, value] of Object.entries(row))
				if (value instanceof Uint8Array) {
					byteCells += 1
					byteLength += value.byteLength
					bytes.push(JSON.stringify([row.id, column, Buffer.from(value).toString('base64')]))
				}
		tables.push({
			name,
			rows: rows.length,
			digest: digest(JSON.stringify(encoded)),
			byteCells,
			byteLength,
			bytesDigest: digest(JSON.stringify(bytes.sort()))
		})
	}
	await writeFile(
		output,
		JSON.stringify({
			version,
			nativeVersion,
			identityPreserved: true,
			appIdProof: digest(appId),
			tables
		})
	)
} finally {
	await jazz.close()
	key.fill(0)
}
