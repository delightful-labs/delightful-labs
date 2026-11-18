import { expect, it } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { app } from './schema.js'
import permissions from './permissions.js'

it('opens the existing production store with the native annotation migration', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'clipper-schema-upgrade-'))
	// Trusted, generated production snapshot; Jazz validates it on publication.
	const wasmSchema: typeof app.wasmSchema = JSON.parse(
		await readFile(
			new URL('./migrations/snapshots/20261118T024230-8a5130d42577.json', import.meta.url),
			'utf8'
		)
	)
	let backend: ReturnType<typeof createJazz> | undefined
	try {
		backend = createJazz({
			app: { wasmSchema },
			permissions: {},
			store: sqlite({ path: directory })
		})
		await backend.ready()
		const appId = backend.appId
		await backend.close()
		backend = undefined
		backend = createJazz({ app, permissions, store: sqlite({ path: directory }) })
		await backend.ready()
		expect(backend.appId).toBe(appId)
		expect(await backend.db.all(app.notes)).toEqual([])
		expect(await backend.db.all(app.highlights)).toEqual([])
		expect(await backend.db.all(app.publications)).toEqual([])
	} finally {
		await backend?.close()
		await rm(directory, { recursive: true, force: true })
	}
})
