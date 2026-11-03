import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
function account(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	return { db: fixture.as(session), id: fixture.accountFor(session) }
}
function identity() {
	return { workspaceId: crypto.randomUUID(), operationId: crypto.randomUUID() }
}
const denied = /denied|rejected/i

it('accepts matching records atomically and hides both from another account', async () => {
	const owner = account('owner'),
		foreign = account('foreign'),
		ids = identity()
	const tx = owner.db.beginTransaction()
	tx.insert(
		app.creationOperations,
		{ ownerId: owner.id, workspaceId: ids.workspaceId, requestFingerprint: 'request-1' },
		{ id: ids.operationId }
	)
	tx.insert(
		app.workspaces,
		{ ownerId: owner.id, creationOperationId: ids.operationId },
		{ id: ids.workspaceId }
	)
	await tx.commit().wait({ tier: 'global' })
	expect(await owner.db.one(app.workspaces.where({ id: ids.workspaceId }))).not.toBeNull()
	expect(await owner.db.one(app.creationOperations.where({ id: ids.operationId }))).not.toBeNull()
	expect(await foreign.db.one(app.workspaces.where({ id: ids.workspaceId }))).toBeNull()
	expect(await foreign.db.one(app.creationOperations.where({ id: ids.operationId }))).toBeNull()
	await expect(
		owner.db
			.update(app.workspaces, ids.workspaceId, { ownerId: foreign.id })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		owner.db.delete(app.workspaces, ids.workspaceId).wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		owner.db
			.update(app.creationOperations, ids.operationId, { requestFingerprint: 'changed' })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		owner.db.delete(app.creationOperations, ids.operationId).wait({ tier: 'global' })
	).rejects.toThrow(denied)
})

it('rejects a mismatched workspace atomically without accepting its marker', async () => {
	const owner = account('atomic-owner'),
		ids = identity()
	const tx = owner.db.beginTransaction()
	tx.insert(
		app.creationOperations,
		{ ownerId: owner.id, workspaceId: crypto.randomUUID(), requestFingerprint: 'mismatch' },
		{ id: ids.operationId }
	)
	tx.insert(
		app.workspaces,
		{ ownerId: owner.id, creationOperationId: ids.operationId },
		{ id: ids.workspaceId }
	)
	await expect(tx.commit().wait({ tier: 'global' })).rejects.toThrow(denied)
	expect(await owner.db.one(app.creationOperations.where({ id: ids.operationId }))).toBeNull()
	expect(await owner.db.one(app.workspaces.where({ id: ids.workspaceId }))).toBeNull()
})

it('rejects forged owners, missing markers and foreign marker substitution', async () => {
	const owner = account('forgery-owner'),
		foreign = account('forgery-foreign'),
		ids = identity()
	await expect(
		foreign.db
			.insert(
				app.creationOperations,
				{ ownerId: owner.id, workspaceId: ids.workspaceId, requestFingerprint: 'forged' },
				{ id: ids.operationId }
			)
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		owner.db
			.insert(
				app.workspaces,
				{ ownerId: owner.id, creationOperationId: crypto.randomUUID() },
				{ id: crypto.randomUUID() }
			)
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await owner.db
		.insert(
			app.creationOperations,
			{ ownerId: owner.id, workspaceId: ids.workspaceId, requestFingerprint: 'owner' },
			{ id: ids.operationId }
		)
		.wait({ tier: 'global' })
	await expect(
		foreign.db
			.insert(
				app.workspaces,
				{ ownerId: foreign.id, creationOperationId: ids.operationId },
				{ id: ids.workspaceId }
			)
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		foreign.db
			.insert(
				app.workspaces,
				{ ownerId: owner.id, creationOperationId: ids.operationId },
				{ id: ids.workspaceId }
			)
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
})

it('permits an owner orphan marker without creating a workspace', async () => {
	const owner = account('orphan-owner'),
		ids = identity()
	await owner.db
		.insert(
			app.creationOperations,
			{ ownerId: owner.id, workspaceId: ids.workspaceId, requestFingerprint: 'orphan' },
			{ id: ids.operationId }
		)
		.wait({ tier: 'global' })
	expect(await owner.db.one(app.creationOperations.where({ id: ids.operationId }))).not.toBeNull()
	expect(await owner.db.one(app.workspaces.where({ id: ids.workspaceId }))).toBeNull()
})
