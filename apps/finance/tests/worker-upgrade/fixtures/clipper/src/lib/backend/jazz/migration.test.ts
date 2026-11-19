import { expect, it } from 'vitest'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { app } from './jazz.generated.js'
import permissions from './jazz.permissions.json' with { type: 'json' }
import retained from '../../../../retained-baseline.json' with { type: 'json' }

it('opens the existing production store with the native annotation migration', async () => {
	const backend = createJazz({
		app,
		permissions,
		store: sqlite({ path: retained.production.directory })
	})
	try {
		await backend.ready()
		expect(backend.appId).toBe(retained.production.appId)
		expect(await backend.db.all(app.notes)).toEqual([])
		expect(await backend.db.all(app.highlights)).toEqual([])
		expect(await backend.db.all(app.publications)).toEqual([])
	} finally {
		await backend.close()
	}
})
