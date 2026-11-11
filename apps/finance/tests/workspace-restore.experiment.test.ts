import { beforeAll, afterAll, afterEach, describe, expect, it } from 'vitest'
import { dirname, resolve } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { chromium, firefox, webkit, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { jazzWasmEntry } from '../tooling/jazz-wasm.js'
import type { Plugin } from 'vite'
import type { RecoverySample } from '../specs/016-workspace-restore/browser.js'
import {
	prepareJazzArchiveExport,
	type JazzArchiveReaderInput,
	type ArchiveHandoffFile
} from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import { prepareArchiveOpen, prepareArchiveSeal } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import {
	parseRestoreJournalRecord,
	type RestoreJournalIntent
} from 'delightful-local-first/backup/restore/journal'
import {
	encodeArchivePayload,
	parseArchivePayload,
	type ArchivePayload,
	type PayloadLimitOverrides
} from 'delightful-local-first/backup/archive'
import { financeBackupReader } from '../src/lib/machines/workspaces/workspace-backup.js'
import { createFinanceRestoreAdapter } from '../src/lib/machines/workspaces/workspace-restore.js'
import {
	financeBackupProfile,
	validateFinanceBackup,
	readFinanceAuthority,
	readFinanceRelations,
	encodeAttachmentBytes
} from '../src/lib/backup/workspace.js'
import {
	prepareFinanceRestorePlan,
	canonicalRecovery,
	financeGraphRows,
	financeRestorePlanningMachine
} from '../src/lib/machines/workspaces/workspace-restore-plan.js'
import { createSilentJazzProxy } from './helpers/silent-jazz-proxy.js'
import type { JazzClient, Db } from 'jazz-tools/backend'
import { openNativeJazzSession as createJazzSession } from './helpers/native-jazz.js'
import type { AccountStore, JazzSession } from 'jazz-tools/client'
import { PersistedWriteRejectedError } from 'jazz-tools'
import type { LocalJazzServerHandle } from 'jazz-tools/testing'
import { deploy, startLocalJazzServer, allowTestBrowserOrigin } from './helpers/jazz-test-server.js'
import { previousApp as app, app as isolationApp, type Organization } from '../src/lib/schema.js'
import isolationPermissions, { previousPermissions as permissions } from '../src/lib/permissions.js'
import { createActor, toPromise, createAsyncLogic } from 'xstate'

function jazzRuntimeAssets(): Plugin {
	return {
		name: 'finance-restore-jazz-assets',
		config: () => ({
			resolve: {
				alias: [
					{ find: /^jazz-wasm$/, replacement: jazzWasmEntry },
					{
						find: /^#jazz-wasm-binary/,
						replacement: resolve(dirname(jazzWasmEntry), 'jazz_wasm_bg.wasm')
					}
				]
			},
			optimizeDeps: {
				// The HTML is middleware-generated, so Vite cannot infer its module entry.
				// Scan the full harness before first load to avoid dependency-triggered reloads.
				entries: ['specs/016-workspace-restore/browser.ts'],
				include: ['jazz-tools', 'jazz-tools/client', 'jazz-tools/local-first']
			}
		})
	}
}
// Exercise the released writer against the actual preceding schema; new application exports use v2.
const legacyFinanceBackupProfile = {
	id: financeBackupProfile.id,
	version: 1,
	validate: (payload: ArchivePayload) =>
		payload.profile.version === 1 && validateFinanceBackup(payload)
}
const legacyFinanceBackupReader = financeBackupReader.provide({
	actors: {
		authority: createAsyncLogic<void, JazzArchiveReaderInput>({
			run: ({ input }) => readFinanceAuthority(input, app)
		}),
		relations: createAsyncLogic<void, JazzArchiveReaderInput>({
			run: ({ input }) => readFinanceRelations(input)
		})
	}
})

let server: LocalJazzServerHandle, owner: Db, authority: Db, foreign: Db, ownerId: string
const sessions: JazzSession<JazzClient>[] = []
function pair(): [string, string] {
	return [crypto.randomUUID(), crypto.randomUUID()]
}
function identifiers() {
	return {
		workspace: crypto.randomUUID(),
		member: crypto.randomUUID(),
		accounts: pair(),
		categories: pair(),
		transactions: pair(),
		transfer: crypto.randomUUID(),
		file: crypto.randomUUID(),
		sourceFile: crypto.randomUUID()
	}
}
type Ids = ReturnType<typeof identifiers>
type Scenario = {
	name: string
	source: 'manual' | 'simplefin'
	links: 'none' | 'direct' | 'later'
	archive: 'none' | 'insert' | 'later'
	attachment: boolean
	expected: 'accepted' | 'rejected'
}
const plain: Scenario = {
	name: 'active manual graph',
	source: 'manual',
	links: 'none',
	archive: 'none',
	attachment: false,
	expected: 'accepted'
}
const bytes = new Uint8Array([0, 255, 128, 7])
const archivedAt = new Date('2026-01-01T00:00:00Z')
/** Pure fixture staging; the SDK owns one native transaction and its rollback. */
function stage(
	tx: Pick<ReturnType<Db['beginTransaction']>, 'insert' | 'update'>,
	ids: Ids,
	scenario: Scenario,
	restore?: {
		ownerId: string
		operationId?: string
		operationName?: string
		transferFacts?: TransferFacts
	}
) {
	const tables = restore ? isolationApp : app
	const actorId = restore?.ownerId ?? ownerId
	const root = {
		ownerId: actorId,
		name: 'Restore qualification',
		kind: 'personal',
		defaultCurrency: 'USD'
	} satisfies Pick<Organization, 'ownerId' | 'name' | 'kind' | 'defaultCurrency'>
	if (restore?.operationId) {
		tx.insert(
			isolationApp.organizations,
			{ ...root, restoreOperationId: restore.operationId },
			{ id: ids.workspace }
		)
		tx.insert(
			isolationApp.restoreOperations,
			{
				workspaceId: ids.workspace,
				sourceFileId: ids.sourceFile,
				ownerId: actorId,
				status: 'incomplete',
				payloadSha256: '1'.repeat(64),
				graphSha256: '2'.repeat(64),
				workspaceName: restore.operationName ?? root.name,
				workspaceKind: root.kind,
				workspaceCurrency: root.defaultCurrency
			},
			{ id: restore.operationId }
		)
	} else {
		tx.insert(tables.organizations, root, { id: ids.workspace })
		tx.insert(
			tables.organizationMembers,
			{
				organizationId: ids.workspace,
				userId: actorId,
				role: 'owner',
				accountAccessMode: 'all'
			},
			{ id: ids.member }
		)
	}
	for (const [index, kind] of ['expense', 'income'].entries()) {
		const accountId = ids.accounts[index],
			categoryId = ids.categories[index],
			id = ids.transactions[index]
		if (!accountId || !categoryId || !id || (kind !== 'expense' && kind !== 'income'))
			throw new Error('Invalid fixture identities')
		tx.insert(
			tables.accounts,
			{
				organizationId: ids.workspace,
				name: 'Ledger ' + index,
				kind: 'cash',
				currency: 'USD',
				...(index === 0 && scenario.archive === 'insert' ? { archivedAt } : {})
			},
			{ id: accountId }
		)
		tx.insert(
			tables.categories,
			{
				organizationId: ids.workspace,
				name: 'Category ' + index,
				kind,
				isSystem: false
			},
			{ id: categoryId }
		)
		tx.insert(
			tables.transactions,
			{
				organizationId: ids.workspace,
				accountId,
				categoryId,
				kind,
				amountMinor: 1234,
				currency: 'USD',
				bookedOn: '2026-01-01',
				description: 'Exact restore ' + index,
				source: scenario.source,
				...(scenario.source === 'simplefin' ? { externalId: 'provider-' + id } : {}),
				...(scenario.links === 'direct' ? { internalTransferId: ids.transfer } : {})
			},
			{ id }
		)
	}
	if (scenario.links !== 'none') {
		stageTransfer(tx, ids, tables, restore?.transferFacts)
		if (scenario.links === 'later')
			for (const id of ids.transactions)
				tx.update(tables.transactions, id, { internalTransferId: ids.transfer })
	}
	if (scenario.attachment) {
		const transactionId = ids.transactions[0]
		tx.insert(
			tables.files,
			{
				transactionId,
				...(restore?.operationId ? { organizationId: ids.workspace } : {}),
				fileName: 'exact.bin',
				mimeType: 'application/octet-stream',
				sizeBytes: bytes.length
			},
			{ id: ids.file }
		)
		tx.insert(tables.transactionAttachments, { transactionId, fileId: ids.file })
		for (let index = 0; index < 2; index++)
			tx.insert(tables.fileParts, {
				fileId: ids.file,
				partIndex: index,
				sizeBytes: 2,
				data: bytes.slice(index * 2, index * 2 + 2)
			})
	}
	if (scenario.archive === 'later') tx.update(tables.accounts, ids.accounts[0], { archivedAt })
}
type TransferFacts = 'shared' | 'sharedCurrency' | 'wrongCurrency' | 'wrongAmount'
function stageTransfer(
	tx: Pick<ReturnType<Db['beginTransaction']>, 'insert'>,
	ids: Ids,
	tables: typeof app | typeof isolationApp = app,
	facts?: TransferFacts
) {
	tx.insert(
		tables.internalTransfers,
		{
			organizationId: ids.workspace,
			expenseTransactionId: ids.transactions[0],
			incomeTransactionId: ids.transactions[1],
			expenseAccountId: ids.accounts[0],
			incomeAccountId: ids.accounts[1],
			...(facts === 'shared'
				? {}
				: { expenseAmountMinor: facts === 'wrongAmount' ? 999 : 1234, incomeAmountMinor: 1234 }),
			...(facts === 'shared' || facts === 'sharedCurrency'
				? {}
				: { expenseCurrency: facts === 'wrongCurrency' ? 'EUR' : 'USD', incomeCurrency: 'USD' }),
			...(facts ? { amountMinor: facts === 'sharedCurrency' ? 999 : 1234, currency: 'USD' } : {})
		},
		{ id: ids.transfer }
	)
}
/** One related authoritative query group, including actual file-part bytes. */
function read(db: Db, ids: Ids, tables: typeof app | typeof isolationApp = app) {
	const options = { tier: 'remote' } satisfies Parameters<Db['all']>[1]
	return Promise.all([
		db.all(tables.organizations.where({ id: ids.workspace }), options),
		db.all(tables.organizationMembers.where({ organizationId: ids.workspace }), options),
		db.all(tables.accounts.where({ organizationId: ids.workspace }).orderBy('id'), options),
		db.all(tables.categories.where({ organizationId: ids.workspace }).orderBy('id'), options),
		db.all(tables.transactions.where({ organizationId: ids.workspace }).orderBy('id'), options),
		db.all(tables.internalTransfers.where({ organizationId: ids.workspace }), options),
		db.all(tables.files.where({ id: ids.file }), options),
		db.all(tables.transactionAttachments.where({ fileId: ids.file }), options),
		db.all(tables.fileParts.where({ fileId: ids.file }).orderBy('partIndex'), options)
	])
}
function expectGraph(
	actual: Awaited<ReturnType<typeof read>>,
	ids: Ids,
	scenario: Scenario,
	actorId = ownerId,
	published = true
) {
	const [workspaces, members, accounts, categories, transactions, transfers, files, links, parts] =
		actual
	expect(workspaces).toHaveLength(1)
	expect(workspaces[0]).toMatchObject({
		id: ids.workspace,
		ownerId: actorId,
		defaultCurrency: 'USD'
	})
	expect(members).toHaveLength(published ? 1 : 0)
	if (published)
		expect(members[0]).toMatchObject({
			id: ids.member,
			organizationId: ids.workspace,
			userId: actorId,
			role: 'owner',
			accountAccessMode: 'all'
		})
	expect(accounts).toHaveLength(2)
	expect(categories).toHaveLength(2)
	expect(transactions).toHaveLength(2)
	for (const [index, kind] of ['expense', 'income'].entries()) {
		const id = ids.transactions[index]
		expect(accounts.find((row) => row.id === ids.accounts[index])).toMatchObject({
			organizationId: ids.workspace,
			name: 'Ledger ' + index,
			kind: 'cash',
			currency: 'USD'
		})
		expect(categories.find((row) => row.id === ids.categories[index])).toMatchObject({
			organizationId: ids.workspace,
			name: 'Category ' + index,
			kind,
			isSystem: false
		})
		const transaction = transactions.find((row) => row.id === id)
		expect(transaction).toMatchObject({
			organizationId: ids.workspace,
			accountId: ids.accounts[index],
			categoryId: ids.categories[index],
			kind,
			amountMinor: 1234,
			currency: 'USD',
			bookedOn: '2026-01-01',
			description: 'Exact restore ' + index,
			source: scenario.source
		})
		expect(transaction?.externalId ?? null).toBe(
			scenario.source === 'simplefin' ? 'provider-' + id : null
		)
		expect(transaction?.internalTransferId ?? null).toBe(
			scenario.links === 'none' ? null : ids.transfer
		)
	}
	expect(transfers).toHaveLength(scenario.links === 'none' ? 0 : 1)
	if (scenario.links !== 'none')
		expect(transfers[0]).toMatchObject({
			id: ids.transfer,
			organizationId: ids.workspace,
			expenseTransactionId: ids.transactions[0],
			incomeTransactionId: ids.transactions[1],
			expenseAccountId: ids.accounts[0],
			incomeAccountId: ids.accounts[1],
			expenseAmountMinor: 1234,
			incomeAmountMinor: 1234,
			expenseCurrency: 'USD',
			incomeCurrency: 'USD'
		})
	expect(accounts.find((row) => row.id === ids.accounts[0])?.archivedAt ?? null).toEqual(
		scenario.archive === 'none' ? null : archivedAt
	)
	expect(files).toHaveLength(scenario.attachment ? 1 : 0)
	expect(links).toHaveLength(scenario.attachment ? 1 : 0)
	expect(parts).toHaveLength(scenario.attachment ? 2 : 0)
	if (scenario.attachment) {
		expect(files[0]).toMatchObject({
			id: ids.file,
			transactionId: ids.transactions[0],
			sizeBytes: bytes.length
		})
		expect(links[0]).toMatchObject({ fileId: ids.file, transactionId: ids.transactions[0] })
		expect(parts.map((part) => [part.fileId, part.partIndex, part.sizeBytes])).toEqual([
			[ids.file, 0, 2],
			[ids.file, 1, 2]
		])
		expect(new Uint8Array(parts.flatMap((part) => [...(part.data ?? [])]))).toEqual(bytes)
	}
}
let original: Ids, originalContents: string
beforeAll(async () => {
	server = await startLocalJazzServer({
		appId: crypto.randomUUID(),
		schema: app,
		permissions,
		inMemory: true,
		allowLocalFirstAuth: true
	})
	for (const initial of [
		'local-first',
		'local-first',
		{ backendSecret: server.backendSecret }
	] satisfies ('local-first' | { backendSecret: string })[]) {
		const session = await createJazzSession({
			appId: server.appId,
			app,
			permissions,
			serverUrl: server.url,
			driver: { type: 'memory' },
			initial
		})
		sessions.push(session)
	}
	const first = sessions[0]?.getSnapshot(),
		other = sessions[1]?.getSnapshot(),
		admin = sessions[2]?.getSnapshot()
	if (!first?.client || !first.account || !other?.client || !admin?.client)
		throw new Error('Missing disposable clients')
	owner = first.client.db
	ownerId = first.account.id
	foreign = other.client.db
	authority = admin.client.db
	owner.onMutationError(() => {})
	original = identifiers()
	const seeded = await owner.transaction((tx) => stage(tx, original, plain))
	await seeded.wait({ tier: 'global' })
	originalContents = JSON.stringify(await read(authority, original))
})
afterEach(async () => {
	expect(JSON.stringify(await read(authority, original))).toBe(originalContents)
})
afterAll(async () => {
	for (const session of sessions) await session.close()
	await server?.stop()
})
const cases = [
	plain,
	{ ...plain, name: 'manual transfer cycle', links: 'direct' },
	{ ...plain, name: 'archived account in initial insert', archive: 'insert', expected: 'rejected' },
	{
		...plain,
		name: 'archive account after staging records in the same bundle',
		archive: 'later',
		expected: 'rejected'
	},
	{
		...plain,
		name: 'provider transfer cycle',
		source: 'simplefin',
		links: 'direct',
		expected: 'rejected'
	},
	{
		...plain,
		name: 'provider transfer linked after initial inserts in the same bundle',
		source: 'simplefin',
		links: 'later',
		expected: 'rejected'
	},
	{
		...plain,
		name: 'original attachment bytes in the same bundle',
		attachment: true,
		expected: 'accepted'
	}
] satisfies Scenario[]
describe('native atomic Finance restore qualification', () => {
	it.each(cases)('$name', async (scenario) => {
		const ids = identifiers(),
			started = performance.now()
		const handle = await owner.transaction((tx) => stage(tx, ids, scenario))
		const verdict = await handle.wait({ tier: 'global' }).then(
			() => 'accepted',
			(error: unknown) => {
				expect(error).toBeInstanceOf(PersistedWriteRejectedError)
				return 'rejected'
			}
		)
		console.info(
			'Restore policy experiment',
			JSON.stringify({
				case: scenario.name,
				verdict,
				elapsedMs: Math.round(performance.now() - started)
			})
		)
		expect(verdict).toBe(scenario.expected)
		const actual = await read(authority, ids)
		if (verdict === 'rejected') {
			expect(actual.every((rows) => rows.length === 0)).toBe(true)
			return
		}
		expectGraph(actual, ids, scenario)
		expect(
			await foreign.all(app.organizations.where({ id: ids.workspace }), { tier: 'remote' })
		).toEqual([])
	})
	it('ordinary owner membership exposes a partially populated workspace', async () => {
		const id = crypto.randomUUID()
		const handle = await owner.transaction((tx) => {
			tx.insert(
				app.organizations,
				{ ownerId, name: 'Partial destination', kind: 'personal', defaultCurrency: 'USD' },
				{ id }
			)
			tx.insert(app.organizationMembers, {
				organizationId: id,
				userId: ownerId,
				role: 'owner',
				accountAccessMode: 'all'
			})
		})
		await handle.wait({ tier: 'global' })
		expect(
			(await owner.all(app.organizations, { tier: 'remote' })).some((row) => row.id === id)
		).toBe(true)
		expect(await owner.all(app.accounts.where({ organizationId: id }), { tier: 'remote' })).toEqual(
			[]
		)
	})
	it('withholding owner membership hides the workspace but denies account creation', async () => {
		const ids = identifiers()
		await owner
			.insert(
				app.organizations,
				{ ownerId, name: 'Hidden destination', kind: 'personal', defaultCurrency: 'USD' },
				{ id: ids.workspace }
			)
			.wait({ tier: 'global' })
		expect(
			await owner.all(app.organizations.where({ id: ids.workspace }), { tier: 'remote' })
		).toEqual([])
		const handle = owner.insert(app.accounts, {
			organizationId: ids.workspace,
			name: 'Denied ledger',
			kind: 'cash',
			currency: 'USD'
		})
		await expect(handle.wait({ tier: 'global' })).rejects.toBeInstanceOf(
			PersistedWriteRejectedError
		)
		expect(
			await authority.all(app.accounts.where({ organizationId: ids.workspace }), { tier: 'remote' })
		).toEqual([])
		expect(
			await authority.all(app.organizations.where({ id: ids.workspace }), { tier: 'remote' })
		).toHaveLength(1)
	})
	it.each([
		{ ...plain, name: 'archive after accepted inserts', archive: 'later' },
		{ ...plain, name: 'link accepted provider endpoints', source: 'simplefin', links: 'later' },
		{
			...plain,
			name: 'link accepted provider endpoints then archive',
			source: 'simplefin',
			links: 'later',
			archive: 'later',
			attachment: true
		}
	] satisfies Scenario[])('$name across separate commits', async (scenario) => {
		const ids = identifiers()
		const initial = { ...scenario, links: 'none', archive: 'none' } satisfies Scenario
		const inserted = await owner.transaction((tx) => stage(tx, ids, initial))
		await inserted.wait({ tier: 'global' })
		// A valid intermediate graph is already visible through the ordinary owner query.
		expectGraph(await read(owner, ids), ids, initial)
		if (scenario.links === 'later') {
			const linked = await owner.transaction((tx) => {
				stageTransfer(tx, ids)
				for (const id of ids.transactions)
					tx.update(app.transactions, id, { internalTransferId: ids.transfer })
			})
			await linked.wait({ tier: 'global' })
		}
		if (scenario.archive === 'later')
			await owner.update(app.accounts, ids.accounts[0], { archivedAt }).wait({ tier: 'global' })
		expectGraph(await read(authority, ids), ids, scenario)
		expect(
			await foreign.all(app.organizations.where({ id: ids.workspace }), { tier: 'remote' })
		).toEqual([])
	})
})

describe('private restore-operation isolation candidate', () => {
	let candidateServer: LocalJazzServerHandle,
		candidate: Db,
		admin: Db,
		stranger: Db,
		ordinary: Db,
		identity: string
	const clients: JazzSession<JazzClient>[] = []
	let stored: string | null = null
	const store: AccountStore = {
		read: () => Promise.resolve(stored),
		update: (transform) => {
			stored = transform(stored)
			return Promise.resolve()
		}
	}
	beforeAll(async () => {
		// Fresh alpha.60 restore target: ordinary and private clients use the released schema.
		candidateServer = await startLocalJazzServer({
			appId: crypto.randomUUID(),
			inMemory: true,
			allowLocalFirstAuth: true
		})
		await deploy({
			appId: candidateServer.appId,
			serverUrl: candidateServer.url,
			adminSecret: candidateServer.adminSecret,
			schema: isolationApp,
			permissions: isolationPermissions
		})
		const ordinarySession = await createJazzSession({
			appId: candidateServer.appId,
			app: isolationApp,
			permissions: isolationPermissions,
			serverUrl: candidateServer.url,
			driver: { type: 'memory' },
			store,
			initial: 'local-first'
		})
		clients.push(ordinarySession)
		const current = ordinarySession.getSnapshot()
		if (!current.client || !current.account) throw new Error('Missing ordinary owner')
		ordinary = current.client.db
		identity = current.account.id
		ordinary.onMutationError(() => {})
		const normalId = crypto.randomUUID()
		const initial = await ordinary.transaction((tx) => {
			tx.insert(
				isolationApp.organizations,
				{ ownerId: identity, name: 'Before restore', kind: 'personal', defaultCurrency: 'USD' },
				{ id: normalId }
			)
			tx.insert(isolationApp.organizationMembers, {
				organizationId: normalId,
				userId: identity,
				role: 'owner',
				accountAccessMode: 'all'
			})
		})
		await initial.wait({ tier: 'global' })
		await ordinary.all(isolationApp.organizations, { tier: 'remote' })
		for (const index of [0, 1, 2]) {
			const session = await createJazzSession({
				appId: candidateServer.appId,
				app: isolationApp,
				permissions: isolationPermissions,
				serverUrl: candidateServer.url,
				driver: { type: 'memory' },
				...(index === 0
					? { store }
					: {
							initial:
								index === 1 ? 'local-first' : { backendSecret: candidateServer.backendSecret }
						})
			})
			clients.push(session)
		}
		const first = clients[1]?.getSnapshot(),
			foreign = clients[2]?.getSnapshot(),
			backend = clients[3]?.getSnapshot()
		if (first?.account?.id !== identity || !first.client || !foreign?.client || !backend?.client)
			throw new Error('Missing isolation clients')
		candidate = first.client.db
		stranger = foreign.client.db
		admin = backend.client.db
		candidate.onMutationError(() => {})
	})
	afterAll(async () => {
		for (const client of clients) await client.close()
		await candidateServer?.stop()
	})
	it('normal creation under isolation policies', async () => {
		const ids = identifiers()
		const write = await candidate.transaction((tx) => stage(tx, ids, plain, { ownerId: identity }))
		await write.wait({ tier: 'global' })
		expectGraph(await read(candidate, ids, isolationApp), ids, plain, identity)
		expectGraph(await read(ordinary, ids, isolationApp), ids, plain, identity)
	})
	it('rejects the whole preparation when its private header differs from the hidden workspace', async () => {
		const ids = identifiers(),
			operationId = crypto.randomUUID()
		const write = await candidate.transaction((tx) =>
			stage(tx, ids, plain, { ownerId: identity, operationId, operationName: 'Different header' })
		)
		await expect(write.wait({ tier: 'global' })).rejects.toBeInstanceOf(PersistedWriteRejectedError)
		expect((await read(admin, ids, isolationApp)).every((rows) => rows.length === 0)).toBe(true)
		expect(
			await admin.one(isolationApp.restoreOperations.where({ id: operationId }), { tier: 'remote' })
		).toBeNull()
	})

	it.each([
		{ facts: 'shared', accepted: true },
		{ facts: 'sharedCurrency', accepted: true },
		{ facts: 'wrongCurrency', accepted: false },
		{ facts: 'wrongAmount', accepted: false }
	] satisfies { facts: TransferFacts; accepted: boolean }[])(
		'checks legacy restore transfer facts: $facts',
		async ({ facts, accepted }) => {
			const ids = identifiers(),
				operationId = crypto.randomUUID()
			const write = await candidate.transaction((tx) =>
				stage(
					tx,
					ids,
					{ ...plain, source: 'simplefin', links: 'direct' },
					{ ownerId: identity, operationId, transferFacts: facts }
				)
			)
			if (accepted) await write.wait({ tier: 'global' })
			else
				await expect(write.wait({ tier: 'global' })).rejects.toBeInstanceOf(
					PersistedWriteRejectedError
				)
			const rows = await read(admin, ids, isolationApp)
			expect(rows[4]).toHaveLength(accepted ? 2 : 0)
			expect(rows[5]).toHaveLength(accepted ? 1 : 0)
			expect(rows[2]).toHaveLength(accepted ? 2 : 0)
			expect(
				await ordinary.all(isolationApp.organizations.where({ id: ids.workspace }), {
					tier: 'remote'
				})
			).toEqual([])
		}
	)
	it('stages an archived provider transfer and bytes without publishing membership', async () => {
		const ids = identifiers(),
			operationId = crypto.randomUUID()
		const scenario = {
			...plain,
			source: 'simplefin',
			links: 'direct',
			archive: 'insert',
			attachment: true
		} satisfies Scenario
		const write = await candidate.transaction((tx) =>
			stage(tx, ids, scenario, { ownerId: identity, operationId })
		)
		await write.wait({ tier: 'global' })
		const actual = await read(admin, ids, isolationApp)
		expectGraph(actual, ids, scenario, identity, false)
		const recoveryRows = await read(candidate, ids, isolationApp)
		expect(recoveryRows[0]).toEqual([])
		expect(recoveryRows.slice(2)).toEqual(actual.slice(2))
		// SDK60 applies read authorization to acknowledged local rows too.
		// The hidden root is recovered through its private restore header.
		expect(
			await candidate.all(isolationApp.organizations.where({ id: ids.workspace }), {
				tier: 'local-first'
			})
		).toHaveLength(0)
		expect(
			await ordinary.all(isolationApp.organizations.where({ id: ids.workspace }), {
				tier: 'remote'
			})
		).toEqual([])
		expect(
			await ordinary.all(isolationApp.organizations.where({ id: ids.workspace }), {
				tier: 'local-first'
			})
		).toEqual([])
		expect((await read(stranger, ids, isolationApp)).every((rows) => rows.length === 0)).toBe(true)
	})
	const attacks = [
		{
			name: 'early owner membership',
			write: (ids) =>
				candidate.insert(isolationApp.organizationMembers, {
					organizationId: ids.workspace,
					userId: identity,
					role: 'owner',
					accountAccessMode: 'all'
				})
		},
		{
			name: 'early sharing',
			write: (ids) =>
				candidate.insert(isolationApp.organizationMembers, {
					organizationId: ids.workspace,
					userId: crypto.randomUUID(),
					role: 'viewer',
					accountAccessMode: 'all'
				})
		},
		{
			name: 'account edit',
			write: (ids) =>
				candidate.update(isolationApp.accounts, ids.accounts[0], { name: 'Changed early' })
		},
		{
			name: 'transaction edit',
			write: (ids) =>
				candidate.update(isolationApp.transactions, ids.transactions[0], {
					description: 'Changed early'
				})
		},
		{
			name: 'transaction deletion',
			write: (ids) => candidate.delete(isolationApp.transactions, ids.transactions[0])
		},
		{
			name: 'workspace edit',
			write: (ids) =>
				candidate.update(isolationApp.organizations, ids.workspace, { name: 'Changed early' })
		},
		{
			name: 'archive substitution on completion',
			write: (_ids, operationId) =>
				candidate.update(isolationApp.restoreOperations, operationId, {
					status: 'active',
					payloadSha256: '3'.repeat(64)
				})
		},
		{
			name: 'workspace substitution on completion',
			write: (_ids, operationId) =>
				candidate.update(isolationApp.restoreOperations, operationId, {
					status: 'active',
					workspaceId: crypto.randomUUID()
				})
		},
		{
			name: 'graph substitution on completion',
			write: (_ids, operationId) =>
				candidate.update(isolationApp.restoreOperations, operationId, {
					status: 'active',
					graphSha256: '3'.repeat(64)
				})
		},
		{
			name: 'owner substitution on completion',
			write: (_ids, operationId) =>
				candidate.update(isolationApp.restoreOperations, operationId, {
					status: 'active',
					ownerId: crypto.randomUUID()
				})
		},
		{
			name: 'source-file substitution on completion',
			write: (_ids, operationId) =>
				candidate.update(isolationApp.restoreOperations, operationId, {
					status: 'active',
					sourceFileId: crypto.randomUUID()
				})
		},

		{
			name: 'header substitution on completion',
			write: (_ids, operationId) =>
				candidate.update(isolationApp.restoreOperations, operationId, {
					status: 'active',
					workspaceName: 'Changed header'
				})
		},
		{
			name: 'replacement operation binding',
			write: (ids) =>
				candidate.insert(isolationApp.restoreOperations, {
					workspaceId: ids.workspace,
					sourceFileId: ids.sourceFile,
					ownerId: identity,
					status: 'incomplete',
					payloadSha256: '1'.repeat(64),
					graphSha256: '2'.repeat(64),
					workspaceName: 'Restore qualification',
					workspaceKind: 'personal',
					workspaceCurrency: 'USD'
				})
		},
		{
			name: 'foreign account insertion',
			write: (ids) =>
				stranger.insert(isolationApp.accounts, {
					organizationId: ids.workspace,
					name: 'Foreign',
					kind: 'cash',
					currency: 'USD'
				})
		}
	] satisfies {
		name: string
		write: (
			ids: Ids,
			operationId: string
		) => { wait(options: { tier: 'global' }): Promise<unknown> }
	}[]
	it.each(attacks)('denies $name while incomplete', async ({ write }) => {
		const ids = identifiers(),
			operationId = crypto.randomUUID()
		const staged = await candidate.transaction((tx) =>
			stage(tx, ids, plain, { ownerId: identity, operationId })
		)
		await staged.wait({ tier: 'global' })
		const before = JSON.stringify(await read(admin, ids, isolationApp))
		await expect(
			Promise.resolve().then<unknown>(() => write(ids, operationId).wait({ tier: 'global' }))
		).rejects.toThrow(/authoriz|denied|reject/i)
		expect(JSON.stringify(await read(admin, ids, isolationApp))).toBe(before)
		expect(
			await admin.one(isolationApp.restoreOperations.where({ id: operationId }), { tier: 'remote' })
		).toMatchObject({
			workspaceId: ids.workspace,
			sourceFileId: ids.sourceFile,
			ownerId: identity,
			status: 'incomplete',
			payloadSha256: '1'.repeat(64),
			graphSha256: '2'.repeat(64),
			workspaceName: 'Restore qualification',
			workspaceKind: 'personal',
			workspaceCurrency: 'USD'
		})
	})
	it('reacquires a hidden destination, publishes atomically and closes reconstruction permissions', async () => {
		const ids = identifiers(),
			operationId = crypto.randomUUID()
		const scenario = {
			...plain,
			source: 'simplefin',
			links: 'direct',
			archive: 'insert',
			attachment: true
		} satisfies Scenario
		const staged = await candidate.transaction((tx) =>
			stage(tx, ids, scenario, { ownerId: identity, operationId })
		)
		await staged.wait({ tier: 'global' })
		await clients[1]?.close()
		const recovered = await createJazzSession({
			appId: candidateServer.appId,
			app: isolationApp,
			permissions: isolationPermissions,
			serverUrl: candidateServer.url,
			driver: { type: 'memory' },
			store
		})
		clients.push(recovered)
		const state = recovered.getSnapshot()
		if (!state.client || state.account?.id !== identity) throw new Error('Missing recovered owner')
		candidate = state.client.db
		candidate.onMutationError(() => {})
		expect(
			await candidate.one(isolationApp.restoreOperations.where({ id: operationId }), {
				tier: 'remote'
			})
		).toMatchObject({
			status: 'incomplete',
			workspaceId: ids.workspace,
			sourceFileId: ids.sourceFile,
			workspaceName: 'Restore qualification',
			workspaceKind: 'personal',
			workspaceCurrency: 'USD'
		})
		expect(
			await candidate.all(isolationApp.organizations.where({ id: ids.workspace }), {
				tier: 'remote'
			})
		).toEqual([])
		expect((await read(candidate, ids, isolationApp)).slice(2)).toEqual(
			(await read(admin, ids, isolationApp)).slice(2)
		)
		const activated = await candidate.transaction((tx) => {
			tx.update(isolationApp.restoreOperations, operationId, { status: 'active' })
			tx.insert(
				isolationApp.organizationMembers,
				{
					organizationId: ids.workspace,
					userId: identity,
					role: 'owner',
					accountAccessMode: 'all'
				},
				{ id: ids.member }
			)
		})
		await activated.wait({ tier: 'global' })
		expectGraph(await read(candidate, ids, isolationApp), ids, scenario, identity)
		expectGraph(await read(ordinary, ids, isolationApp), ids, scenario, identity)
		await expect(
			candidate
				.insert(isolationApp.accounts, {
					organizationId: ids.workspace,
					name: 'Late archived insert',
					kind: 'cash',
					currency: 'USD',
					archivedAt
				})
				.wait({ tier: 'global' })
		).rejects.toBeInstanceOf(PersistedWriteRejectedError)
		await expect(
			candidate
				.update(isolationApp.restoreOperations, operationId, { status: 'incomplete' })
				.wait({ tier: 'global' })
		).rejects.toBeInstanceOf(PersistedWriteRejectedError)
		await expect(
			candidate
				.update(isolationApp.organizations, ids.workspace, {
					restoreOperationId: crypto.randomUUID()
				})
				.wait({ tier: 'global' })
		).rejects.toBeInstanceOf(PersistedWriteRejectedError)
		await candidate
			.update(isolationApp.transactions, ids.transactions[1], {
				description: 'Editable after publication'
			})
			.wait({ tier: 'global' })
		expect(
			await ordinary.one(isolationApp.transactions.where({ id: ids.transactions[1] }), {
				tier: 'remote'
			})
		).toMatchObject({
			source: 'simplefin',
			amountMinor: 1234,
			description: 'Editable after publication'
		})
		await ordinary
			.update(isolationApp.organizations, ids.workspace, { name: 'Edited by cached client' })
			.wait({ tier: 'global' })
		expect(
			await admin.one(isolationApp.organizations.where({ id: ids.workspace }), { tier: 'remote' })
		).toMatchObject({ name: 'Edited by cached client', restoreOperationId: operationId })
		await expect(
			candidate
				.update(isolationApp.organizations, ids.workspace, {
					restoreOperationId: crypto.randomUUID()
				})
				.wait({ tier: 'global' })
		).rejects.toBeInstanceOf(PersistedWriteRejectedError)
		expect(
			await admin.one(isolationApp.restoreOperations.where({ id: operationId }), { tier: 'remote' })
		).toMatchObject({ status: 'active', workspaceId: ids.workspace })
	})
	it('cannot attach restore permissions to an existing normal workspace', async () => {
		const ids = identifiers(),
			operationId = crypto.randomUUID()
		const write = await candidate.transaction((tx) => stage(tx, ids, plain, { ownerId: identity }))
		await write.wait({ tier: 'global' })
		const before = JSON.stringify(await read(admin, ids, isolationApp))
		await expect(
			candidate
				.update(isolationApp.organizations, ids.workspace, { restoreOperationId: operationId })
				.wait({ tier: 'global' })
		).rejects.toBeInstanceOf(PersistedWriteRejectedError)
		// Duplicate insertion must be rejected, whether locally or by authority.
		await expect(
			Promise.resolve().then(() =>
				candidate
					.insert(
						isolationApp.organizations,
						{
							ownerId: identity,
							name: 'Replaced root',
							kind: 'personal',
							defaultCurrency: 'USD',
							restoreOperationId: operationId
						},
						{ id: ids.workspace }
					)
					.wait({ tier: 'global' })
			)
		).rejects.toThrow(/already exists|authoriz|denied|reject/i)
		await expect(
			candidate
				.insert(
					isolationApp.restoreOperations,
					{
						workspaceId: ids.workspace,
						sourceFileId: ids.sourceFile,
						ownerId: identity,
						status: 'incomplete',
						payloadSha256: '1'.repeat(64),
						graphSha256: '2'.repeat(64),
						workspaceName: 'Restore qualification',
						workspaceKind: 'personal',
						workspaceCurrency: 'USD'
					},
					{ id: operationId }
				)
				.wait({ tier: 'global' })
		).rejects.toBeInstanceOf(PersistedWriteRejectedError)
		expect(JSON.stringify(await read(admin, ids, isolationApp))).toBe(before)
	})
})

describe('browser replica separation', () => {
	let web: ViteDevServer, serving: LocalJazzServerHandle, url: string
	beforeAll(async () => {
		const require = createRequire(import.meta.url),
			wasm = jazzWasmEntry
		web = await createServer({
			configFile: false,
			root: process.cwd(),
			cacheDir: resolve('node_modules/.vite/restore-isolation'),
			plugins: [
				jazzRuntimeAssets(),
				{
					name: 'finance-restore-harness',
					configureServer(server) {
						server.middlewares.use(
							'/specs/016-workspace-restore/browser.html',
							(_request, response) => {
								response.setHeader('Content-Type', 'text/html')
								response.end(
									'<!doctype html><html lang="en"><meta charset="utf-8"><title>Restore experiment</title><script type="module" src="/specs/016-workspace-restore/browser.ts"></script></html>'
								)
							}
						)
					}
				}
			],
			resolve: { alias: { '#lib': resolve('src/lib') } },
			server: {
				host: '0.0.0.0',
				port: 0,
				fs: {
					allow: [
						process.cwd(),
						dirname(require.resolve('jazz-tools')),
						...(wasm ? [dirname(wasm)] : [])
					]
				}
			}
		})
		await web.listen()
		const address = web.httpServer?.address()
		if (!address || typeof address === 'string') throw new Error('Missing browser harness address')
		url = `http://localhost:${address.port}/specs/016-workspace-restore/browser.html`
		allowTestBrowserOrigin(url)
		console.info('Restore isolation browser harness', {
			localhost: url,
			network: web.resolvedUrls?.network
		})
	})
	afterAll(async () => {
		await web?.close()
		await serving?.stop()
	})
	it.each([
		{ name: 'chromium', engine: chromium },
		{ name: 'firefox', engine: firefox },
		{ name: 'webkit', engine: webkit }
	])(
		'$name keeps restore writes out of the ordinary replica',
		async ({ name, engine }) => {
			const browser = await engine.launch({
				headless: true,
				...(name === 'chromium' ? { channel: 'chromium' } : {})
			})
			try {
				serving = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					inMemory: true,
					allowLocalFirstAuth: true
				})
				await deploy({
					appId: serving.appId,
					serverUrl: serving.url,
					adminSecret: serving.adminSecret,
					schema: isolationApp,
					permissions: isolationPermissions
				})
				const page = await browser.newPage()
				page.on('pageerror', (error) =>
					console.error('Restore harness module error', error.message)
				)
				await page.goto(url)
				await page.waitForFunction(() => Boolean(window.financeRestoreIsolation))
				const result = await page.evaluate(
					async ({ appId, serverUrl }) => {
						const api = window.financeRestoreIsolation
						const ordinarySession = await api.openLocalFirstSession({
							appId,
							serverUrl,
							driver: { type: 'persistent', dbName: 'ordinary' },
							initial: 'local-first'
						})
						const state = ordinarySession.getSnapshot()
						if (!state.client || !state.account) throw new Error('Missing persistent owner')
						const ordinary = state.client.db,
							ownerId = state.account.id
						await ordinary.all(api.app.organizations, { tier: 'remote' })
						const existingId = crypto.randomUUID()
						const existing = await ordinary.transaction((tx) => {
							tx.insert(
								api.app.organizations,
								{ ownerId, name: 'Before upgrade', kind: 'personal', defaultCurrency: 'USD' },
								{ id: existingId }
							)
							tx.insert(api.app.organizationMembers, {
								organizationId: existingId,
								userId: ownerId,
								role: 'owner',
								accountAccessMode: 'all'
							})
						})
						await existing.wait({ tier: 'global' })
						await ordinary.all(api.app.organizations, { tier: 'remote' })
						const restore = await api.openAccountClient({
							appId,
							serverUrl,
							account: state.account,
							driver: { type: 'persistent', dbName: 'restore-' + crypto.randomUUID() }
						})
						const workspace = crypto.randomUUID(),
							operation = crypto.randomUUID()
						const query = api.app.organizations.where({ id: workspace })
						const snapshots: number[] = [],
							subscriptionErrors: string[] = []
						let reveal: (() => void) | undefined
						const appeared = new Promise<void>((resolve) => {
							reveal = resolve
						})
						const unsubscribe = ordinary.subscribe(
							query,
							{
								onUpdate: (rows) => {
									snapshots.push(rows.length)
									if (rows.length === 1) reveal?.()
								},
								onError: (error) => subscriptionErrors.push(error.name)
							},
							{ tier: 'local-first' }
						)
						try {
							await ordinary.all(query, { tier: 'remote' })
							const write = await restore.db.transaction((tx) => {
								tx.insert(
									api.app.organizations,
									{
										ownerId,
										name: 'Browser isolation',
										kind: 'personal',
										defaultCurrency: 'USD',
										restoreOperationId: operation
									},
									{ id: workspace }
								)
								tx.insert(
									api.app.restoreOperations,
									{
										workspaceId: workspace,
										sourceFileId: crypto.randomUUID(),
										ownerId,
										status: 'incomplete',
										payloadSha256: '1'.repeat(64),
										graphSha256: '2'.repeat(64),
										workspaceName: 'Browser isolation',
										workspaceKind: 'personal',
										workspaceCurrency: 'USD'
									},
									{ id: operation }
								)
								tx.insert(api.app.accounts, {
									organizationId: workspace,
									name: 'Archived',
									kind: 'cash',
									currency: 'USD',
									archivedAt: new Date('2026-01-01T00:00:00Z')
								})
							})
							await write.wait({ tier: 'global' })
							const before = {
								writerLocal: (
									await restore.db.all(api.app.organizations.where({ id: workspace }), {
										tier: 'local-first'
									})
								).length,
								ordinaryLocal: (await ordinary.all(query, { tier: 'local-first' })).length,
								ordinaryRemote: (await ordinary.all(query, { tier: 'remote' })).length
							}
							const stagedSnapshots = [...snapshots]
							const activation = await restore.db.transaction((tx) => {
								tx.update(api.app.restoreOperations, operation, { status: 'active' })
								tx.insert(api.app.organizationMembers, {
									organizationId: workspace,
									userId: ownerId,
									role: 'owner',
									accountAccessMode: 'all'
								})
							})
							await activation.wait({ tier: 'global' })
							await Promise.race([
								appeared,
								new Promise<never>((_resolve, reject) =>
									setTimeout(
										() =>
											reject(
												new Error(
													'Ordinary live catalog did not observe publication within five seconds'
												)
											),
										5000
									)
								)
							])
							const published = await ordinary.all(query, { tier: 'remote' })
							const archived = await ordinary.all(
								api.app.accounts.where({ organizationId: workspace }),
								{ tier: 'remote' }
							)
							await ordinary
								.update(api.app.organizations, workspace, { name: 'Edited after restore' })
								.wait({ tier: 'global' })
							const edited = await ordinary.one(query, { tier: 'local-first' })
							const unchanged = await ordinary.one(
								api.app.organizations.where({ id: existingId }),
								{ tier: 'remote' }
							)
							return {
								before,
								stagedSnapshots,
								subscriptionErrors,
								published: published.length,
								archived: archived.length,
								archiveDate: archived[0]?.archivedAt?.toISOString(),
								editedName: edited?.name,
								existingName: unchanged?.name
							}
						} finally {
							unsubscribe()
							await restore.shutdown()
							await ordinarySession.close()
						}
					},
					{ appId: serving.appId, serverUrl: serving.url }
				)
				expect(result.stagedSnapshots.length).toBeGreaterThan(0)
				expect(result.stagedSnapshots.every((count) => count === 0)).toBe(true)
				expect(result).toMatchObject({
					before: { writerLocal: 0, ordinaryRemote: 0, ordinaryLocal: 0 },
					subscriptionErrors: [],
					published: 1,
					archived: 1,
					archiveDate: '2026-01-01T00:00:00.000Z',
					editedName: 'Edited after restore',
					existingName: 'Before upgrade'
				})
			} finally {
				await browser.close()
				await serving?.stop()
			}
		},
		60_000
	)
	describe('DLF browser recovery', () => {
		let source: Ids,
			sourceSnapshot: Awaited<ReturnType<typeof read>>,
			retainedFile: number[],
			payload: ArchivePayload
		beforeAll(async () => {
			source = identifiers()
			const seeded = await owner.transaction((tx) =>
				stage(tx, source, { ...plain, source: 'simplefin', attachment: true })
			)
			await seeded.wait({ tier: 'global' })
			const linked = await owner.transaction((tx) => {
				stageTransfer(tx, source)
				for (const id of source.transactions)
					tx.update(app.transactions, id, { internalTransferId: source.transfer })
			})
			await linked.wait({ tier: 'global' })
			const extra = {
				check: crypto.randomUUID(),
				transaction: crypto.randomUUID(),
				tag: crypto.randomUUID(),
				batch: crypto.randomUUID(),
				template: crypto.randomUUID(),
				file: crypto.randomUUID(),
				profile: crypto.randomUUID(),
				connection: crypto.randomUUID(),
				attempt: crypto.randomUUID()
			}
			const expanded = await owner.transaction((tx) => {
				const organizationId = source.workspace,
					accountId = source.accounts[0],
					categoryId = source.categories[0]
				tx.insert(
					app.transactionBatches,
					{ organizationId, name: 'Archived batch' },
					{ id: extra.batch }
				)
				tx.insert(app.batchTemplates, { organizationId, name: 'Template' }, { id: extra.template })
				tx.insert(
					app.tags,
					{ organizationId, categoryId, kind: 'expense', name: 'Historical tag' },
					{ id: extra.tag }
				)
				tx.insert(
					app.checks,
					{
						organizationId,
						accountId,
						checkNumber: '0012',
						checkDate: '2026-01-02',
						payerName: 'Payer'
					},
					{ id: extra.check }
				)
				tx.insert(
					app.transactions,
					{
						organizationId,
						accountId,
						categoryId,
						amountMinor: 27,
						kind: 'expense',
						currency: 'USD',
						bookedOn: '2026-01-03',
						source: 'manual',
						paymentMethod: 'check',
						checkId: extra.check,
						batchId: extra.batch,
						memo: 'Keep this memo'
					},
					{ id: extra.transaction }
				)
				tx.insert(app.transactionTags, {
					organizationId,
					transactionId: extra.transaction,
					tagId: extra.tag
				})
				tx.insert(
					app.files,
					{
						transactionId: extra.transaction,
						accountId,
						fileName: 'second.bin',
						mimeType: 'application/octet-stream',
						sizeBytes: 4
					},
					{ id: extra.file }
				)
				tx.insert(app.transactionAttachments, {
					transactionId: extra.transaction,
					fileId: extra.file
				})
				tx.insert(app.fileParts, {
					fileId: extra.file,
					partIndex: 0,
					sizeBytes: 4,
					data: new Uint8Array([4, 0, 10, 255])
				})
				tx.insert(
					app.profiles,
					{ userId: ownerId, displayName: 'Historical owner' },
					{ id: extra.profile }
				)
				tx.update(app.organizationMembers, source.member, { profileId: extra.profile })
				tx.insert(app.accountMemberships, {
					organizationId,
					accountId,
					userId: ownerId,
					access: 'read',
					canDelete: false
				})
				tx.insert(
					app.simplefinConnections,
					{
						organizationId,
						ownerId,
						accessUrl: '',
						status: 'active',
						claimedAt: new Date('2026-01-01T00:00:00Z')
					},
					{ id: extra.connection }
				)
				tx.insert(app.simplefinAccountLinks, {
					organizationId,
					accountId,
					connectionId: extra.connection,
					simplefinAccountId: 'source-provider-account'
				})
				tx.insert(
					app.simplefinSyncAttempts,
					{
						organizationId,
						connectionId: extra.connection,
						initiatedBy: ownerId,
						startedAt: new Date('2026-01-01T00:00:00Z'),
						outcome: 'unfinished',
						importSettlement: 'notStarted'
					},
					{ id: extra.attempt }
				)
				tx.insert(app.simplefinSyncAccountResults, {
					organizationId,
					attemptId: extra.attempt,
					accountId,
					accountName: 'Historical ledger',
					outcome: 'unfinished'
				})
			})
			await expanded.wait({ tier: 'global' })
			await owner.update(app.tags, extra.tag, { archivedAt }).wait({ tier: 'global' })
			await owner
				.update(app.simplefinSyncAttempts, extra.attempt, {
					outcome: 'succeeded',
					finishedAt: new Date('2026-01-01T00:01:00Z'),
					importSettlement: 'confirmed',
					importedCount: 0
				})
				.wait({ tier: 'global' })
			await owner.update(app.accounts, source.accounts[0], { archivedAt }).wait({ tier: 'global' })
			sourceSnapshot = await read(owner, source)
			const captured: Uint8Array[] = []
			const request = prepareJazzArchiveExport({
				db: owner,
				profile: legacyFinanceBackupProfile,
				binding: {
					applicationId: 'delightful-finances',
					environment: 'disposable',
					identityId: ownerId,
					workspaceId: source.workspace,
					operationId: crypto.randomUUID(),
					generation: 0
				},
				protection: { kind: 'none' },
				isCurrent: () => true,
				handoff: {
					dispatch: (file: ArchiveHandoffFile) => {
						captured.push(file.copyBytes())
						return Promise.resolve('dispatched')
					}
				}
			})
			const exported = createActor(createJazzArchiveExportMachine(legacyFinanceBackupReader), {
				input: { request }
			}).start()
			expect((await toPromise(exported)).outcome).toBe('exported')
			await request.release()
			const file = captured[0]
			if (!file) throw new Error('Missing actual Finance export')
			retainedFile = [...file]
			const opened = prepareArchiveOpen(file),
				actor = createActor(createArchiveEnvelopeMachine(), { input: { request: opened } }).start(),
				result = await toPromise(actor)
			if (result.outcome !== 'integrityChecked')
				throw new Error('Finance export failed independent reopening')
			payload = result.archive.readPayload()
			expect(legacyFinanceBackupProfile.validate(payload)).toBe(true)
			expect(new Set([...payload.records, ...payload.references].map((row) => row.type)).size).toBe(
				19
			)
			result.archive.release()
			opened.release()
		})
		afterEach(async () => {
			expect(await read(owner, source)).toEqual(sourceSnapshot)
		})
		async function sealPlanPayload(value: ArchivePayload) {
			const request = prepareArchiveSeal(value, { kind: 'none' })
			const result = await toPromise(
				createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
			)
			if (result.outcome !== 'sealed') throw new Error('Test archive failed sealing')
			try {
				return [...result.archive.copyBytes()]
			} finally {
				result.archive.release()
				request.release()
			}
		}
		it('native destination retains shutdown ahead of later controls during validation', async () => {
			const sample = await recoverySample(retainedFile, server.appId, ownerId),
				opened = prepareArchiveOpen(new Uint8Array(sample.file))
			const checked = await toPromise(
				createActor(createArchiveEnvelopeMachine(), { input: { request: opened } }).start()
			)
			if (checked.outcome !== 'integrityChecked') throw new Error('Missing checked source')
			const gate = Promise.withResolvers<boolean>()
			const adapter = createFinanceRestoreAdapter(owner, sample, checked.archive, () => {
				throw new Error('Validation cannot acquire transaction custody')
			})
			const destination = adapter.destination.provide({
					actors: { fingerprint: createAsyncLogic({ run: () => gate.promise }) }
				}),
				operation = sample.intent.operation,
				binding = {
					applicationId: operation.applicationId,
					environment: operation.environment,
					identityId: operation.identityId,
					operationId: operation.operationId,
					workspaceId: operation.destinationWorkspaceId,
					generation: 1
				}
			const actor = createActor(destination, {
				input: {
					binding,
					databaseName: sample.databaseName,
					intent: sample.intent,
					step: sample.intent.plan.preparation,
					operation: 'remote'
				}
			}).start()
			try {
				actor.send({ type: 'SHUTDOWN' })
				actor.send({ type: 'CANCEL' })
				actor.send({ type: 'INVALIDATE', binding })
				expect(actor.getSnapshot().status).toBe('active')
				gate.resolve(true)
				expect(await toPromise(actor)).toBe('closed')
			} finally {
				gate.resolve(true)
				checked.archive.release()
				opened.release()
			}
		})
		it('validates v2 without history and rejects malformed embedded history before planning', async () => {
			const base = {
				...payload,
				profile: { ...payload.profile, version: 2 },
				coverage: {
					...payload.coverage,
					recordTypes: [...payload.coverage.recordTypes, 'sourceDocuments']
				}
			}
			expect(financeBackupProfile.validate(base)).toBe(true)
			expect(legacyFinanceBackupProfile.validate(base)).toBe(false)
			const sourceId = crypto.randomUUID()
			for (const embedded of [
				payload,
				{
					...payload,
					records: payload.records.map((row) =>
						row.type === 'organizations'
							? {
									...row,
									fields: { ...row.fields, accessUrl: { kind: 'text', value: 'forbidden-field' } }
								}
							: row
					)
				}
			] satisfies ArchivePayload[]) {
				const bytes = encodeArchivePayload(embedded),
					sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
						.map((byte) => byte.toString(16).padStart(2, '0'))
						.join('')
				const document = {
					type: 'sourceDocuments',
					id: sourceId,
					fields: {
						organizationId: {
							kind: 'reference',
							type: 'organizations',
							id: payload.source.workspaceId
						},
						payloadSha256: { kind: 'text', value: sha256 },
						fileName: { kind: 'text', value: 'source.json' },
						mimeType: { kind: 'text', value: 'application/json' },
						sizeBytes: { kind: 'integer', value: String(bytes.byteLength) },
						originalBytes: { kind: 'attachment', id: sourceId }
					}
				} satisfies ArchivePayload['references'][number]
				const value = {
					...base,
					references: [...base.references, document],
					attachments: [
						...base.attachments,
						{
							id: sourceId,
							fileName: 'source.json',
							mediaType: 'application/json',
							sizeBytes: bytes.byteLength,
							sha256,
							data: encodeAttachmentBytes(bytes)
						}
					]
				}
				expect(financeBackupProfile.validate(value)).toBe(embedded === payload)
				if (embedded !== payload)
					await expect(
						recoverySample(await sealPlanPayload(value), crypto.randomUUID(), crypto.randomUUID())
					).rejects.toThrow('Finance restore planning failed')
				bytes.fill(0)
			}
		})
		it('plans empty attachments and a workspace without domain rows', async () => {
			const identity = crypto.randomUUID(),
				applicationId = crypto.randomUUID()
			const withoutFiles = {
				...payload,
				records: payload.records.filter(
					(row) => row.type !== 'files' && row.type !== 'transactionAttachments'
				),
				attachments: []
			}
			const noFiles = await recoverySample(
				await sealPlanPayload(withoutFiles),
				applicationId,
				identity
			)
			expect(noFiles.graph.files).toEqual([])
			expect(noFiles.graph.parts).toEqual([])
			const rootOnly = {
				...payload,
				records: payload.records.filter((row) => row.type === 'organizations'),
				references: [],
				attachments: []
			}
			const empty = await recoverySample(await sealPlanPayload(rootOnly), applicationId, identity)
			expect(empty.intent.plan.batches).toEqual([])
			expect(empty.intent.plan.mappings).toHaveLength(1)
		})
		it('chunks original bytes at 256 KiB and rebuilds identical part IDs', async () => {
			const file = payload.attachments[0]
			if (!file) throw new Error('Missing source attachment')
			const bytes = Uint8Array.from({ length: 256 * 1024 + 1 }, (_, index) => index % 256)
			const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('')
			const value = {
				...payload,
				records: payload.records.map((row) =>
					row.type === 'files' && row.id === file.id
						? ({
								...row,
								fields: {
									...row.fields,
									sizeBytes: { kind: 'integer', value: String(bytes.length) }
								}
							} satisfies ArchivePayload['records'][number])
						: row
				),
				attachments: payload.attachments.map((row) =>
					row.id === file.id
						? { ...row, sizeBytes: bytes.length, sha256: sha, data: encodeAttachmentBytes(bytes) }
						: row
				)
			}
			const retained = await sealPlanPayload(value),
				identity = crypto.randomUUID(),
				appId = crypto.randomUUID()
			const first = await recoverySample(retained, appId, identity)
			const mapped = first.intent.plan.mappings.find(
				(row) => row.kind === 'record' && row.type === 'files' && row.sourceId === file.id
			)
			const parts = first.graph.parts.filter((part) => part.fileId === mapped?.destinationId)
			expect(parts.map((part) => part.sizeBytes)).toEqual([256 * 1024, 1])
			expect(new Uint8Array(parts.flatMap((part) => part.data))).toEqual(bytes)
			expect(await recoverySample(retained, appId, identity, first.intent)).toEqual(first)
		})
		it('maps the same source UUID separately for different record types', async () => {
			const account = payload.records.find((row) => row.type === 'accounts')
			const category = payload.records.find((row) => row.type === 'categories')
			if (!account || !category) throw new Error('Missing source identities')
			const value = {
				...payload,
				records: payload.records.map((row) => ({
					...row,
					id: row.type === 'categories' && row.id === category.id ? account.id : row.id,
					fields: Object.fromEntries(
						Object.entries(row.fields).map(([name, field]) => [
							name,
							field.kind === 'reference' && field.type === 'categories' && field.id === category.id
								? { ...field, id: account.id }
								: field
						])
					)
				}))
			}
			const sample = await recoverySample(
				await sealPlanPayload(value),
				crypto.randomUUID(),
				crypto.randomUUID()
			)
			const ids = sample.intent.plan.mappings.filter(
				(row) => row.kind === 'record' && row.sourceId === account.id
			)
			expect(ids).toHaveLength(2)
			expect(new Set(ids.map((row) => row.destinationId)).size).toBe(2)
		})
		it('rejects invalid source scope before decoding rows or deriving IDs', async () => {
			const opened = prepareArchiveOpen(new Uint8Array(retainedFile))
			const checked = await toPromise(
				createActor(createArchiveEnvelopeMachine(), { input: { request: opened } }).start()
			)
			if (checked.outcome !== 'integrityChecked') throw new Error('Missing checked file')
			const binding = {
				applicationId: crypto.randomUUID(),
				environment: 'test',
				identityId: crypto.randomUUID(),
				operationId: crypto.randomUUID(),
				workspaceId: payload.source.workspaceId,
				generation: 1
			}
			try {
				for (const invalid of [
					{ ...binding, identityId: 'invalid' },
					{ ...binding, operationId: 'invalid' },
					{ ...binding, workspaceId: crypto.randomUUID() }
				]) {
					const request = prepareFinanceRestorePlan(checked.archive, invalid)
					const states: string[] = []
					const actor = createActor(financeRestorePlanningMachine, { input: { request } })
					actor.subscribe((snapshot) => states.push(snapshot.value))
					expect(await toPromise(actor.start())).toEqual({ outcome: 'failed' })
					expect(states).toEqual(['readingSource', 'failed'])
					expect(() => request.read()).toThrow('Released restore plan')
				}
				expect(checked.archive.readPayload()).toEqual(payload)
			} finally {
				checked.archive.release()
				opened.release()
			}
		})
		it.each([
			'archive',
			'mapping',
			'fingerprint',
			'identity',
			'mapping UUID',
			'collision',
			'destination'
		])('rejects substituted %s before exposing a plan', async (field) => {
			const appId = crypto.randomUUID(),
				identity = crypto.randomUUID()
			const sample = await recoverySample(retainedFile, appId, identity)
			const collisionId = sample.intent.plan.mappings[1]?.destinationId
			if (!collisionId) throw new Error('Missing mapping for collision test')
			const previous = {
				...sample.intent,
				operation:
					field === 'destination'
						? { ...sample.intent.operation, destinationWorkspaceId: crypto.randomUUID() }
						: sample.intent.operation,
				archive:
					field === 'archive'
						? { ...sample.intent.archive, payloadSha256: '0'.repeat(64) }
						: sample.intent.archive,
				plan:
					field === 'mapping'
						? { ...sample.intent.plan, mappings: sample.intent.plan.mappings.slice(1) }
						: field === 'mapping UUID' || field === 'collision'
							? {
									...sample.intent.plan,
									mappings: sample.intent.plan.mappings.map((row, index) =>
										index === 0
											? {
													...row,
													destinationId: field === 'mapping UUID' ? 'invalid' : collisionId
												}
											: row
									)
								}
							: field === 'fingerprint'
								? { ...sample.intent.plan, sha256: '0'.repeat(64) }
								: sample.intent.plan
			}
			const states: string[] = []
			await expect(
				recoverySample(
					retainedFile,
					appId,
					field === 'identity' ? crypto.randomUUID() : identity,
					previous,
					(state) => states.push(state)
				)
			).rejects.toThrow('Finance restore planning failed')
			const rejectedAfter: Record<string, string> = {
				archive: 'readingSource',
				identity: 'readingSource',
				mapping: 'indexing',
				'mapping UUID': 'indexing',
				collision: 'projecting',
				fingerprint: 'validatingIntent',
				destination: 'validatingIntent'
			}
			expect(states.at(-2)).toBe(rejectedAfter[field])
			expect(states.at(-1)).toBe('failed')
		})
		it.each([
			'readingSource',
			'decoding',
			'indexing',
			'derivingIds',
			'projecting',
			'fingerprintingGraph',
			'fingerprintingWrites',
			'fingerprintingPlan',
			'validatingIntent'
		] satisfies import('xstate').SnapshotFrom<typeof financeRestorePlanningMachine>['value'][])(
			'cancels during %s without publishing late results',
			async (state) => {
				const opened = prepareArchiveOpen(new Uint8Array(retainedFile))
				const checked = await toPromise(
					createActor(createArchiveEnvelopeMachine(), { input: { request: opened } }).start()
				)
				if (checked.outcome !== 'integrityChecked') throw new Error('Missing checked file')
				const binding = {
					applicationId: crypto.randomUUID(),
					environment: 'test',
					identityId: crypto.randomUUID(),
					operationId: crypto.randomUUID(),
					workspaceId: payload.source.workspaceId,
					generation: 1
				}
				const request = prepareFinanceRestorePlan(checked.archive, binding)
				const actor = createActor(financeRestorePlanningMachine, { input: { request } })
				let retained: { read(): unknown }[] = []
				const subscription = actor.subscribe((snapshot) => {
					expect(JSON.stringify(snapshot)).not.toContain('Exact restore')
					expect(JSON.stringify(snapshot)).not.toContain('Keep this memo')
					if (snapshot.matches(state)) {
						retained = [
							snapshot.context.source,
							snapshot.context.decoded,
							snapshot.context.graph
						].filter((value) => value !== undefined)
						subscription.unsubscribe()
						actor.send({ type: 'INVALIDATE', binding: { ...binding, generation: 2 } })
						expect(actor.getSnapshot().status).toBe('active')
						actor.send({ type: 'INVALIDATE', binding })
					}
				})
				try {
					expect(await toPromise(actor.start())).toEqual({ outcome: 'cancelled' })
					await new Promise((resolve) => setTimeout(resolve, 0))
					expect(() => request.read()).toThrow('Released restore plan')
					for (const value of retained) expect(() => value.read()).toThrow('Missing planning input')
					expect(JSON.stringify(actor.getSnapshot())).not.toContain('Exact restore')
					expect(checked.archive.readPayload()).toEqual(payload)
				} finally {
					subscription.unsubscribe()
					request.release()
					checked.archive.release()
					opened.release()
				}
			}
		)

		async function openOwner(page: Page, appId: string, serverUrl: string, fresh: boolean) {
			await page.goto(url)
			await page.waitForFunction(() => Boolean(window.financeRestoreRecovery))
			return page.evaluate(
				async ({ appId, serverUrl, fresh }) => {
					const session = await window.financeRestoreIsolation.openLocalFirstSession({
						appId,
						serverUrl,
						driver: { type: 'persistent', dbName: 'ordinary' },
						...(fresh ? { initial: 'local-first' } : {})
					})
					window.financeRecoveryOwner = session
					const state = session.getSnapshot()
					if (!state.account || !state.client) throw new Error('Missing recovery identity')
					return state.account.id
				},
				{ appId, serverUrl, fresh }
			)
		}
		async function attach(
			page: Page,
			sample: RecoverySample,
			serverUrl: string,
			generation: number,
			heldWriteId?: string
		) {
			return page.evaluate(
				async ({ sample, serverUrl, generation, heldWriteId }) => {
					const api = window.financeRestoreRecovery,
						state = window.financeRecoveryOwner.getSnapshot()
					if (!state.account) throw new Error('Missing recovery owner')
					const opened = api.prepareArchiveOpen(new Uint8Array(sample.file)),
						opening = api
							.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opened } })
							.start()
					const checked = await api.toPromise(opening)
					if (checked.outcome !== 'integrityChecked')
						throw new Error('Recovery file failed reopening')
					const planning = api.prepareFinanceRestorePlan(
						checked.archive,
						{
							applicationId: sample.intent.operation.applicationId,
							environment: sample.intent.operation.environment,
							identityId: sample.intent.operation.identityId,
							operationId: sample.intent.operation.operationId,
							workspaceId: sample.intent.archive.source.workspaceId,
							generation
						},
						sample.intent
					)
					try {
						const result = await api.toPromise(
							api
								.createActor(api.financeRestorePlanningMachine, { input: { request: planning } })
								.start()
						)
						if (result.outcome !== 'planned') throw new Error('Browser planning failed')
						const plan = structuredClone(result.plan.read())
						if (
							api.canonicalRecovery(plan) !==
							api.canonicalRecovery({ graph: sample.graph, intent: sample.intent })
						)
							throw new Error('Browser and Node plans differ')
						sample = { ...sample, ...plan }
					} finally {
						planning.release()
					}
					const client = await window.financeRestoreIsolation.openAccountClient({
						appId: sample.intent.operation.applicationId,
						serverUrl,
						account: state.account,
						driver: { type: 'persistent', dbName: 'restore-' + sample.intent.operation.operationId }
					})
					const operation = sample.intent.operation
					const binding = {
						applicationId: operation.applicationId,
						environment: operation.environment,
						identityId: operation.identityId,
						workspaceId: operation.destinationWorkspaceId,
						operationId: operation.operationId,
						generation
					}
					window.financeRecoveryRuntime = {
						client,
						sample,
						binding,
						opened,
						archive: checked.archive,
						probe: api.createRecoveryProbe(client.db, sample, checked.archive, heldWriteId),
						actor: undefined
					}
				},
				{ sample, serverUrl, generation, heldWriteId }
			)
		}
		async function journal(page: Page, mode: 'initialize' | 'load') {
			return page.evaluate(async (mode) => {
				const api = window.financeRestoreRecovery,
					runtime = window.financeRecoveryRuntime
				const command = mode === 'initialize' ? { mode } : { mode, intent: runtime.sample.intent }
				const actor = api
					.createActor(api.createRestoreJournalStepMachine(), {
						input: { databaseName: runtime.sample.databaseName, binding: runtime.binding, command }
					})
					.start()
				return api.toPromise(actor)
			}, mode)
		}
		async function runWrite(page: Page, writeId: string) {
			return page.evaluate(async (writeId) => {
				const api = window.financeRestoreRecovery,
					runtime = window.financeRecoveryRuntime
				const actor = api
					.createActor(runtime.probe.machine, {
						input: {
							binding: runtime.binding,
							databaseName: runtime.sample.databaseName,
							intent: runtime.sample.intent,
							writeId
						}
					})
					.start()
				runtime.actor = actor
				return api.toPromise(actor)
			}, writeId)
		}
		async function compare(page: Page) {
			const loaded = await journal(page, 'load')
			if (!loaded.record) throw new Error('Missing comparison journal')
			return page.evaluate(async (record) => {
				const api = window.financeRestoreRecovery,
					runtime = window.financeRecoveryRuntime
				const actor = api
					.createActor(runtime.probe.comparison, {
						input: { record, binding: runtime.binding, databaseName: runtime.sample.databaseName }
					})
					.start()
				return api.toPromise(actor)
			}, loaded.record)
		}
		it('a failed test wire barrier cannot authorize a native write', async () => {
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const browser = await chromium.launch({ channel: 'chromium' }),
				page = await browser.newPage()
			try {
				const identity = await openOwner(page, core.appId, core.url, true),
					sample = await recoverySample(retainedFile, core.appId, identity)
				await attach(page, sample, core.url, 1, 'preparation')
				await page.evaluate(() => {
					window.pauseRecoveryReplies = async () => {
						throw new Error('Controlled wire barrier failure')
					}
				})
				expect((await journal(page, 'initialize')).outcome).toBe('initialized')
				expect((await runWrite(page, 'preparation')).outcome).toBe('incomplete')
				expect((await journal(page, 'load')).record?.checkpoint).toMatchObject({
					current: { status: 'notIssued', issuance: 0 }
				})
				expect(
					await page.evaluate(async () => {
						const runtime = window.financeRecoveryRuntime,
							db = window.financeRecoveryOwner.getSnapshot().client?.db
						if (!db) throw new Error('Missing ordinary owner')
						return {
							commits: runtime.probe.commits,
							operations: await db.all(
								window.financeRestoreIsolation.app.restoreOperations.where({
									id: runtime.sample.intent.operation.operationId
								}),
								{ tier: 'remote' }
							)
						}
					})
				).toEqual({ commits: [], operations: [] })
				await page.evaluate(async () => {
					const runtime = window.financeRecoveryRuntime
					await runtime.client.shutdown({ waitForSync: true })
					runtime.archive.release()
					runtime.opened.release()
				})
			} finally {
				await browser.close()
				await core.stop()
			}
		}, 60_000)
		async function observeOwnerCatalog(page: Page, workspaceId: string) {
			return page.evaluate(async (workspaceId) => {
				const session = window.financeRecoveryOwner.getSnapshot(),
					db = session.client?.db
				if (!db || !session.account) throw new Error('Missing ordinary account')
				const userId = session.account.id
				const app = window.financeRestoreIsolation.app,
					originalId = crypto.randomUUID()
				const original = await db.transaction((tx) => {
					tx.insert(
						app.organizations,
						{
							name: 'Existing ordinary workspace',
							kind: 'personal',
							defaultCurrency: 'USD',
							ownerId: userId
						},
						{ id: originalId }
					)
					tx.insert(app.organizationMembers, {
						organizationId: originalId,
						userId,
						role: 'owner',
						accountAccessMode: 'all'
					})
				})
				await original.wait({ tier: 'global' })
				const query = app.organizations
				let reveal = () => {}
				const published = new Promise<void>((resolve) => {
					reveal = resolve
				})
				const close = db.subscribe(
					query,
					{
						onUpdate: (rows) => {
							if (rows.some((row) => row.id === workspaceId)) reveal()
						}
					},
					{ tier: 'local-first' }
				)
				window.financeRestoreCatalog = { published, close }
				await db.all(query, { tier: 'remote' })
				return originalId
			}, workspaceId)
		}

		async function startOwnedSession(
			page: Page,
			sample: RecoverySample,
			serverUrl: string,
			mode: 'new' | 'resume',
			fault:
				| 'none'
				| 'acquisition'
				| 'commit'
				| 'rollback'
				| 'close'
				| 'open-rejected'
				| 'commit-rejected' = 'none'
		) {
			await page.evaluate(
				async ({ sample, serverUrl, mode, fault }) => {
					const api = window.financeRestoreRecovery,
						account = window.financeRecoveryOwner.getSnapshot().account
					if (!account) throw new Error('Missing selected account')
					const opened = api.prepareArchiveOpen(new Uint8Array(sample.file))
					const checked = await api.toPromise(
						api
							.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opened } })
							.start()
					)
					if (checked.outcome !== 'integrityChecked') throw new Error('Missing original archive')
					const operation = sample.intent.operation
					const sourceBinding = {
						applicationId: operation.applicationId,
						environment: operation.environment,
						identityId: operation.identityId,
						operationId: operation.operationId,
						workspaceId: sample.intent.archive.source.workspaceId,
						generation: 1
					}
					const planning = api.prepareFinanceRestorePlan(
						checked.archive,
						sourceBinding,
						sample.intent
					)
					const planned = await api.toPromise(
						api
							.createActor(api.financeRestorePlanningMachine, { input: { request: planning } })
							.start()
					)
					if (planned.outcome !== 'planned') throw new Error('Session planning failed')
					const plan = planned.plan.read(),
						binding = { ...sourceBinding, workspaceId: operation.destinationWorkspaceId }
					const stats = {
						acquisitions: 0,
						opened: 0,
						closeAttempts: 0,
						releases: 0,
						transactions: 0,
						rollbackAttempts: 0
					}
					let releaseAcquisition = () => {},
						releaseTransaction = () => {},
						commits: () => string[] = () => []
					const acquisition = new Promise<void>((resolve) => {
						releaseAcquisition = resolve
					})
					let transactionDidOpen = () => {}
					const transactionOpened = new Promise<void>((resolve) => {
						transactionDidOpen = resolve
					})
					const transaction = new Promise<void>((resolve) => {
						releaseTransaction = resolve
					})
					const machine = api.createFinanceRestoreSession(
						{
							account,
							serverUrl,
							binding,
							intent: plan.intent,
							databaseName: sample.databaseName,
							mode,
							releaseArtifacts: () => {
								stats.releases++
								planning.release()
								checked.archive.release()
								opened.release()
							}
						},
						(db, retain) => {
							const adapter = api.createRecoveryProbe(
								db,
								{ ...sample, ...plan },
								checked.archive,
								fault === 'commit' ? 'financial-graph' : undefined,
								retain
							)
							commits = () => [...adapter.commits]
							if (fault === 'open-rejected')
								adapter.writer.open = () => {
									stats.transactions++
									return Promise.reject(new Error('Injected acquisition rejection'))
								}
							if (fault === 'commit-rejected') {
								const commit = adapter.writer.commit
								adapter.writer.commit = async (tx) => {
									const write = await commit(tx)
									await adapter.writer.acceptRemote(write)
									throw new Error('Injected lost commit receipt after native commit')
								}
							}
							if (fault === 'rollback') {
								const open = adapter.writer.open,
									rollback = adapter.writer.rollback
								adapter.writer.open = () => {
									const value = open()
									stats.transactions++
									transactionDidOpen()
									return transaction.then(() => value)
								}
								adapter.writer.rollback = (value) => {
									stats.rollbackAttempts++
									return stats.rollbackAttempts <= 2 ? Promise.resolve(false) : rollback(value)
								}
							}
							return adapter
						},
						async (config) => {
							stats.acquisitions++
							const client = await window.financeRestoreIsolation.openAccountClient(config)
							stats.opened++
							if (fault === 'acquisition' || fault === 'close') await acquisition
							return {
								...client,
								shutdown: (settings?: Parameters<typeof client.shutdown>[0]) => {
									stats.closeAttempts++
									return fault === 'close' && stats.closeAttempts === 1
										? Promise.reject(new Error('Controlled close failure'))
										: client.shutdown(settings)
								}
							}
						}
					)
					const actor = api.createActor(machine)
					window.financeRestoreSessionRuntime = {
						actor,
						stats,
						transactionOpened,
						commits: () => commits(),
						releaseAcquisition: () => releaseAcquisition(),
						releaseTransaction: () => releaseTransaction()
					}
					actor.start()
				},
				{ sample, serverUrl, mode, fault }
			)
		}
		async function retainedSource(page: Page, sample: RecoverySample) {
			return page.evaluate(async (sample) => {
				const db = window.financeRecoveryOwner.getSnapshot().client?.db,
					api = window.financeRestoreRecovery,
					app = window.financeRestoreIsolation.app
				if (!db) throw new Error('Missing ordinary owner')
				const file = await db.one(app.files.where({ id: sample.graph.source.file.id }), {
					tier: 'remote'
				})
				const parts = await db.all(
					app.fileParts.where({ fileId: sample.graph.source.file.id }).orderBy('partIndex'),
					{ tier: 'remote' }
				)
				const bytes = new Uint8Array(sample.graph.source.file.sizeBytes)
				for (const part of parts) {
					if (!part.data) throw new Error('Missing retained bytes')
					bytes.set(part.data, part.partIndex * 256 * 1024)
				}
				try {
					const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
						.map((byte) => byte.toString(16).padStart(2, '0'))
						.join('')
					return { file, hash, payload: api.parseArchivePayload(bytes) }
				} finally {
					bytes.fill(0)
				}
			}, sample)
		}
		it.each([
			{ name: 'chromium', engine: chromium },
			{ name: 'firefox', engine: firefox },
			{ name: 'webkit', engine: webkit }
		])(
			'$name application restore factory owns native client and artifact release',
			async ({ name, engine }) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const browser = await engine.launch({
						headless: true,
						...(name === 'chromium' ? { channel: 'chromium' } : {})
					}),
					page = await browser.newPage()
				try {
					const identity = await openOwner(page, core.appId, core.url, true),
						sample = await recoverySample(retainedFile, core.appId, identity)
					const results = await page.evaluate(
						async ({ sample, serverUrl }) => {
							const api = window.financeRestoreRecovery,
								account = window.financeRecoveryOwner.getSnapshot().account,
								operation = sample.intent.operation
							if (!account) throw new Error('Missing ordinary identity')
							const authorizedAccount = account
							async function run(mode: 'new' | 'resume') {
								const opened = api.prepareArchiveOpen(new Uint8Array(sample.file)),
									checked = await api.toPromise(
										api
											.createActor(api.createArchiveEnvelopeMachine(), {
												input: { request: opened }
											})
											.start()
									)
								if (checked.outcome !== 'integrityChecked') throw new Error('Missing checked file')
								const sourceBinding = {
										applicationId: operation.applicationId,
										environment: operation.environment,
										identityId: operation.identityId,
										operationId: operation.operationId,
										workspaceId: sample.intent.archive.source.workspaceId,
										generation: 1
									},
									planning = api.prepareFinanceRestorePlan(
										checked.archive,
										sourceBinding,
										sample.intent
									)
								const planned = await api.toPromise(
									api
										.createActor(api.financeRestorePlanningMachine, {
											input: { request: planning }
										})
										.start()
								)
								if (planned.outcome !== 'planned') throw new Error('Missing browser plan')
								const events: string[] = []
								const machine = api.createFinanceWorkspaceRestore(
									{
										account: authorizedAccount,
										serverUrl,
										mode,
										databaseName: sample.databaseName,
										binding: { ...sourceBinding, workspaceId: operation.destinationWorkspaceId },
										archive: checked.archive,
										plan: planning,
										releaseFile: () => {
											events.push('releaseFile')
											opened.release()
										}
									},
									async (config) => {
										events.push('acquire')
										const client = await window.financeRestoreIsolation.openAccountClient(config)
										return {
											...client,
											shutdown: (settings?: Parameters<typeof client.shutdown>[0]) => {
												events.push('close')
												return client.shutdown(settings).then(() => {
													events.push('closed')
												})
											}
										}
									}
								)
								const actor = api.createActor(machine).start(),
									result = await api.toPromise(actor)
								let planReleased = false,
									archiveReleased = false
								try {
									planning.read()
								} catch {
									planReleased = true
								}
								try {
									checked.archive.readPayload()
								} catch {
									archiveReleased = true
								}
								return {
									result,
									events,
									planReleased,
									archiveReleased,
									snapshot: JSON.stringify(actor.getSnapshot())
								}
							}
							return {
								missing: await run('resume'),
								created: await run('new'),
								historical: await run('resume')
							}
						},
						{ sample, serverUrl: core.url }
					)
					expect(results.missing).toMatchObject({
						result: { outcome: 'incomplete', record: undefined },
						events: ['releaseFile'],
						planReleased: true,
						archiveReleased: true
					})
					expect(results.created).toMatchObject({
						result: { outcome: 'complete', record: { checkpoint: { kind: 'complete' } } },
						events: ['acquire', 'close', 'closed', 'releaseFile'],
						planReleased: true,
						archiveReleased: true
					})
					expect(results.historical).toMatchObject({
						result: results.created.result,
						events: ['releaseFile'],
						planReleased: true,
						archiveReleased: true
					})
					for (const value of Object.values(results))
						expect(value.snapshot).not.toContain('Exact restore')
					expect(await retainedSource(page, sample)).toEqual({
						file: sample.graph.source.file,
						hash: sample.intent.archive.payloadSha256,
						payload
					})
				} finally {
					await browser.close()
					await core.stop()
				}
			},
			60_000
		)
		it.each([
			{ name: 'chromium', engine: chromium },
			{ name: 'firefox', engine: firefox },
			{ name: 'webkit', engine: webkit }
		])(
			'$name file controller reselects after reload, drains cancellation and retries blocked cleanup',
			async ({ name, engine }) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const browser = await engine.launch({
						headless: true,
						...(name === 'chromium' ? { channel: 'chromium' } : {})
					}),
					page = await browser.newPage()
				try {
					const identity = await openOwner(page, core.appId, core.url, true)
					const first = await page.evaluate(
						async ({ file, appId, serverUrl }) => {
							const api = window.financeRestoreRecovery,
								session = window.financeRecoveryOwner,
								gate = Promise.withResolvers<void>(),
								acquired = Promise.withResolvers<void>()
							const actor = api
								.createActor(
									api.createWorkspaceRestoreController(undefined, async (config) => {
										const client = await window.financeRestoreIsolation.openAccountClient(config)
										acquired.resolve()
										await gate.promise
										return client
									})
								)
								.start()
							const request = api.prepareWorkspaceRestoreFile(
								new File([new Uint8Array(file)], 'backup.dlf'),
								''
							)
							api.bindWorkspaceRestoreFile(request, session, {
								appId,
								serverUrl,
								environment: 'dev'
							})
							actor.send({ type: 'SUBMIT', request })
							await api.waitFor(
								actor,
								(snapshot) => api.selectWorkspaceRestoreReport(snapshot).view.canConfirm
							)
							const binding = actor.getSnapshot().context.binding
							if (!binding) throw new Error('Missing derived binding')
							actor.send({ type: 'CONFIRM' })
							await acquired.promise
							actor.send({ type: 'CANCEL' })
							const retainedWhileAcquiring = api.selectWorkspaceRestoreReport(actor.getSnapshot())
								.view.busy
							gate.resolve()
							await api.waitFor(
								actor,
								(snapshot) => !api.selectWorkspaceRestoreReport(snapshot).view.busy
							)
							const view = api.selectWorkspaceRestoreReport(actor.getSnapshot()).view,
								serialized = JSON.stringify(actor.getSnapshot())
							actor.stop()
							await session.close()
							return { binding, view, retainedWhileAcquiring, serialized }
						},
						{ file: retainedFile, appId: core.appId, serverUrl: core.url }
					)
					expect(first.retainedWhileAcquiring).toBe(true)
					expect(first.view.message).toBe('cancelled')
					expect(first.serialized).not.toContain('Keep this memo')
					expect(await openOwner(page, core.appId, core.url, false)).toBe(identity)
					const resumed = await page.evaluate(
						async ({ file, appId, serverUrl }) => {
							const api = window.financeRestoreRecovery,
								session = window.financeRecoveryOwner
							let closeAttempts = 0
							const actor = api
									.createActor(
										api.createWorkspaceRestoreController(undefined, async (config) => {
											const client = await window.financeRestoreIsolation.openAccountClient(config)
											return {
												...client,
												shutdown: async (options) => {
													closeAttempts++
													if (closeAttempts === 1)
														throw new Error('Injected close failure before native close')
													await client.shutdown(options)
												}
											}
										})
									)
									.start(),
								request = api.prepareWorkspaceRestoreFile(
									new File([new Uint8Array(file)], 'backup.dlf'),
									''
								)
							api.bindWorkspaceRestoreFile(request, session, {
								appId,
								serverUrl,
								environment: 'dev'
							})
							actor.send({ type: 'SUBMIT', request })
							await api.waitFor(
								actor,
								(snapshot) => api.selectWorkspaceRestoreReport(snapshot).view.canConfirm
							)
							const review = api.selectWorkspaceRestoreReport(actor.getSnapshot()).view,
								binding = actor.getSnapshot().context.binding
							if (!binding) throw new Error('Missing resume binding')
							actor.send({ type: 'CONFIRM' })
							await api.waitFor(
								actor,
								(snapshot) => api.selectWorkspaceRestoreReport(snapshot).view.canRetryRelease
							)
							const blockedView = api.selectWorkspaceRestoreReport(actor.getSnapshot()).view
							actor.send({ type: 'CANCEL' })
							actor.send({ type: 'SCOPE_CHANGED' })
							actor.send({ type: 'DRAIN' })
							const nativeInterruption = actor.getSnapshot().context.native?.getSnapshot()
								.context.interruption
							actor.send({ type: 'RETRY_RELEASE' })
							await api.waitFor(
								actor,
								(snapshot) => !api.selectWorkspaceRestoreReport(snapshot).view.busy
							)
							const view = api.selectWorkspaceRestoreReport(actor.getSnapshot()).view
							actor.stop()
							const journal = await api.toPromise(
								api
									.createActor(api.createRestoreJournalStepMachine(), {
										input: {
											binding,
											databaseName: 'finance-workspace-restores',
											command: { mode: 'discover' }
										}
									})
									.start()
							)
							let acquisitions = 0
							const history = api
									.createActor(
										api.createWorkspaceRestoreController(undefined, async () => {
											acquisitions++
											throw new Error('Completed history cannot acquire a client')
										})
									)
									.start(),
								historicalFile = api.prepareWorkspaceRestoreFile(
									new File([new Uint8Array(file)], 'backup.dlf'),
									''
								)
							api.bindWorkspaceRestoreFile(historicalFile, session, {
								appId,
								serverUrl,
								environment: 'dev'
							})
							history.send({ type: 'SUBMIT', request: historicalFile })
							await api.waitFor(
								history,
								(snapshot) => !api.selectWorkspaceRestoreReport(snapshot).view.busy
							)
							const historicalView = api.selectWorkspaceRestoreReport(history.getSnapshot()).view
							history.stop()
							return {
								binding,
								review,
								view,
								journal,
								historicalView,
								acquisitions,
								closeAttempts,
								nativeInterruption,
								blockedView
							}
						},
						{ file: retainedFile, appId: core.appId, serverUrl: core.url }
					)
					expect(resumed.binding).toEqual(first.binding)
					expect(resumed.review.confirmAction).toBe('create')
					expect(resumed.blockedView).toMatchObject({
						busy: true,
						canRetryRelease: true,
						editable: false,
						message: 'failed'
					})
					expect(resumed.closeAttempts).toBe(2)
					expect(resumed.view).toMatchObject({ message: undefined, busy: false, canOpen: false })
					expect(resumed.nativeInterruption).toBe('closed')
					expect(resumed.historicalView.message).toBe('done')
					expect(resumed.acquisitions).toBe(0)
					expect(resumed.journal.record?.checkpoint.kind).toBe('complete')
					const intent = resumed.journal.record?.intent
					if (!intent) throw new Error('Missing durable resumed intent')
					const sample = await recoverySample(retainedFile, core.appId, identity, intent)
					expect(await retainedSource(page, sample)).toEqual({
						file: sample.graph.source.file,
						hash: intent.archive.payloadSha256,
						payload
					})
				} finally {
					await browser.close()
					await core.stop()
				}
			},
			60_000
		)

		async function exportRestored(
			page: Page,
			sample: RecoverySample,
			limits?: PayloadLimitOverrides
		) {
			return page.evaluate(
				async ({ sample, limits }) => {
					const api = window.financeRestoreRecovery,
						state = window.financeRecoveryOwner.getSnapshot()
					if (!state.client || !state.account) throw new Error('Missing ordinary owner')
					const files: number[][] = []
					const request = api.prepareJazzArchiveExport({
						db: state.client.db,
						profile: api.financeBackupProfile,
						binding: {
							applicationId: 'delightful-finances',
							environment: 'disposable',
							identityId: state.account.id,
							workspaceId: sample.graph.workspace.id,
							operationId: crypto.randomUUID(),
							generation: 0
						},
						...(limits ? { limits } : {}),
						protection: { kind: 'none' },
						isCurrent: () => true,
						handoff: {
							dispatch: async (file) => {
								files.push([...file.copyBytes()])
								return 'dispatched'
							}
						}
					})
					try {
						const result = await api.toPromise(
							api
								.createActor(api.createJazzArchiveExportMachine(api.financeBackupReader), {
									input: { request }
								})
								.start()
						)
						return { result, files }
					} finally {
						await request.release()
					}
				},
				{ sample, limits }
			)
		}
		async function openExport(file: number[]) {
			const request = prepareArchiveOpen(new Uint8Array(file))
			const result = await toPromise(
				createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
			)
			if (result.outcome !== 'integrityChecked') throw new Error('Subsequent backup failed opening')
			try {
				return result.archive.readPayload()
			} finally {
				result.archive.release()
				request.release()
			}
		}
		it('refuses a subsequent backup when retained source bytes no longer match the sealed hash', async () => {
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const browser = await chromium.launch({ channel: 'chromium' }),
				page = await browser.newPage()
			const backend = await createJazzSession({
				appId: core.appId,
				app: isolationApp,
				permissions: isolationPermissions,
				serverUrl: core.url,
				driver: { type: 'memory' },
				initial: { backendSecret: core.backendSecret }
			})
			try {
				const identity = await openOwner(page, core.appId, core.url, true),
					sample = await recoverySample(retainedFile, core.appId, identity)
				await startOwnedSession(page, sample, core.url, 'new')
				expect(
					(
						await page.evaluate(() =>
							window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
						)
					).outcome
				).toBe('complete')
				const db = backend.getSnapshot().client?.db
				if (!db) throw new Error('Missing corruption injector')
				const part = await db.one(
					isolationApp.fileParts
						.where({ fileId: sample.graph.source.file.id })
						.orderBy('partIndex'),
					{ tier: 'remote' }
				)
				if (!part?.data) throw new Error('Missing retained source bytes')
				const corrupted = part.data.slice()
				corrupted[0] = corrupted[0] === 0 ? 1 : 0
				await db
					.update(isolationApp.fileParts, part.id, { data: corrupted })
					.wait({ tier: 'global' })
				const captured = await exportRestored(page, sample)
				expect(captured.result).toMatchObject({
					outcome: 'failed',
					code: 'invalidData',
					archiveProduced: false,
					handoff: 'notStarted'
				})
				expect(captured.files).toEqual([])
			} finally {
				await backend.close()
				await browser.close()
				await core.stop()
			}
		}, 60_000)
		it.each([
			{ name: 'chromium', engine: chromium },
			{ name: 'firefox', engine: firefox },
			{ name: 'webkit', engine: webkit }
		])(
			'$name preserves history through backup, restore, backup and restore',
			async ({ name, engine }) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const browser = await engine.launch({
						headless: true,
						...(name === 'chromium' ? { channel: 'chromium' } : {})
					}),
					page = await browser.newPage()
				try {
					const identity = await openOwner(page, core.appId, core.url, true),
						first = await recoverySample(retainedFile, core.appId, identity)
					await startOwnedSession(page, first, core.url, 'new')
					expect(
						(
							await page.evaluate(() =>
								window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
							)
						).outcome
					).toBe('complete')
					const limited = await exportRestored(page, first, {
						attachmentBytes: first.graph.source.file.sizeBytes - 1
					})
					expect(limited.result).toMatchObject({
						outcome: 'failed',
						code: 'invalidData'
					})
					expect(limited.files).toEqual([])
					const captured = await exportRestored(page, first)
					expect(captured.result.outcome).toBe('exported')
					expect(captured.files).toHaveLength(1)
					const file = captured.files[0]
					if (!file) throw new Error('Missing subsequent backup')
					const subsequent = await openExport(file)
					expect(financeBackupProfile.validate(subsequent)).toBe(true)
					expect(legacyFinanceBackupProfile.validate(subsequent)).toBe(false)
					const documents = subsequent.references.filter((row) => row.type === 'sourceDocuments'),
						document = documents[0],
						history = subsequent.attachments.find((file) => file.id === document?.id)
					expect(documents).toHaveLength(1)
					if (!document || !history) throw new Error('Missing retained history')
					expect(history.sha256).toBe(first.intent.archive.payloadSha256)
					expect(
						parseArchivePayload(Uint8Array.from(atob(history.data), (char) => char.charCodeAt(0)))
					).toEqual(payload)
					const mutate = (fields: ArchivePayload['references'][number]['fields']) => ({
						...subsequent,
						references: subsequent.references.map((row) =>
							row === document ? { ...row, fields: { ...row.fields, ...fields } } : row
						)
					})
					for (const fields of [
						{
							organizationId: { kind: 'reference', type: 'organizations', id: crypto.randomUUID() }
						},
						{ payloadSha256: { kind: 'text', value: '0'.repeat(64) } },
						{ originalBytes: { kind: 'attachment', id: crypto.randomUUID() } },
						{ accessUrl: { kind: 'text', value: 'must never be admitted' } }
					] satisfies ArchivePayload['references'][number]['fields'][])
						expect(financeBackupProfile.validate(mutate(fields))).toBe(false)
					expect(
						financeBackupProfile.validate({
							...subsequent,
							records: [...subsequent.records, document],
							references: subsequent.references.filter((row) => row !== document)
						})
					).toBe(false)
					expect(
						financeBackupProfile.validate({
							...subsequent,
							attachments: subsequent.attachments.filter((file) => file !== history)
						})
					).toBe(false)
					const second = await recoverySample(file, core.appId, identity)
					expect(second.graph.files).toHaveLength(first.graph.files.length)
					expect(second.graph.parts.map((part) => canonicalRecovery(part.data)).sort()).toEqual(
						first.graph.parts.map((part) => canonicalRecovery(part.data)).sort()
					)
					expect(second.intent.plan.mappings.some((row) => row.sourceId === document.id)).toBe(
						false
					)
					await startOwnedSession(page, second, core.url, 'new')
					expect(
						(
							await page.evaluate(() =>
								window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
							)
						).outcome
					).toBe('complete')
					expect(await retainedSource(page, second)).toEqual({
						file: second.graph.source.file,
						hash: second.intent.archive.payloadSha256,
						payload: subsequent
					})
					const next = await exportRestored(page, second)
					expect(next.result.outcome).toBe('exported')
					const nextFile = next.files[0]
					if (!nextFile) throw new Error('Missing second subsequent backup')
					expect(financeBackupProfile.validate(await openExport(nextFile))).toBe(true)
				} finally {
					await browser.close()
					await core.stop()
				}
			},
			60_000
		)

		it.each([
			{ name: 'chromium', engine: chromium },
			{ name: 'firefox', engine: firefox },
			{ name: 'webkit', engine: webkit }
		])(
			'$name session owner completes and treats completed journals as history',
			async ({ name, engine }) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const profile = await mkdtemp(resolve(tmpdir(), 'finance-restore-recovery-'))
				const context = await engine.launchPersistentContext(profile, {
					headless: true,
					...(name === 'chromium' ? { channel: 'chromium' } : {})
				})
				try {
					const page = context.pages()[0] ?? (await context.newPage())
					const identity = await openOwner(page, core.appId, core.url, true)
					const sample = await recoverySample(retainedFile, core.appId, identity)
					const existingWorkspaceId = await observeOwnerCatalog(page, sample.graph.workspace.id)
					await startOwnedSession(page, sample, core.url, 'new')
					const result = await page.evaluate(() =>
						window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
					)
					expect(result).toMatchObject({
						outcome: 'complete',
						record: { checkpoint: { kind: 'complete' } }
					})
					expect(
						await page.evaluate(() => ({
							...window.financeRestoreSessionRuntime.stats,
							commits: window.financeRestoreSessionRuntime.commits().length
						}))
					).toMatchObject({ acquisitions: 1, closeAttempts: 1, releases: 1, commits: 3 })
					expect(
						await page.evaluate(() =>
							JSON.stringify(window.financeRestoreSessionRuntime.actor.getSnapshot())
						)
					).not.toContain('Exact restore')
					const source = await retainedSource(page, sample)
					expect(source).toEqual({
						file: sample.graph.source.file,
						hash: sample.intent.archive.payloadSha256,
						payload
					})
					expect(legacyFinanceBackupProfile.validate(source.payload)).toBe(true)

					const id = sample.graph.transactions.find((row) =>
						sample.graph.accounts.some(
							(account) => account.id === row.accountId && account.archivedAt === null
						)
					)?.id
					if (!id) throw new Error('Missing restored transaction')
					await page.evaluate(async (id) => {
						await Promise.race([
							window.financeRestoreCatalog.published,
							new Promise<never>((_resolve, reject) =>
								setTimeout(
									() => reject(new Error('Ordinary catalog did not observe publication')),
									5000
								)
							)
						])
						const db = window.financeRecoveryOwner.getSnapshot().client?.db
						if (!db) throw new Error('Missing ordinary client')
						await db.all(window.financeRestoreIsolation.app.transactions.where({ id }), {
							tier: 'remote'
						})
						await db
							.update(window.financeRestoreIsolation.app.transactions, id, {
								description: 'Ordinary later edit'
							})
							.wait({ tier: 'global' })
					}, id)
					await startOwnedSession(page, sample, core.url, 'resume')
					expect(
						await page.evaluate(() =>
							window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
						)
					).toEqual(result)
					expect(
						await page.evaluate(() => ({
							...window.financeRestoreSessionRuntime.stats,
							commits: window.financeRestoreSessionRuntime.commits()
						}))
					).toMatchObject({ acquisitions: 0, closeAttempts: 0, releases: 1, commits: [] })
					expect(
						await page.evaluate(async (existingWorkspaceId) => {
							const db = window.financeRecoveryOwner.getSnapshot().client?.db
							if (!db) throw new Error('Missing ordinary client')
							return (
								await db.one(
									window.financeRestoreIsolation.app.organizations.where({
										id: existingWorkspaceId
									}),
									{ tier: 'remote' }
								)
							)?.name
						}, existingWorkspaceId)
					).toBe('Existing ordinary workspace')
				} finally {
					await context.close()
					await core.stop()
					await rm(profile, { recursive: true, force: true })
				}
			},
			60_000
		)
		it.each(['CANCEL', 'SHUTDOWN', 'INVALIDATE'] satisfies (
			'CANCEL' | 'SHUTDOWN' | 'INVALIDATE'
		)[])(
			'session owner retains late client acquisition after %s',
			async (interruption) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const browser = await chromium.launch({ channel: 'chromium' }),
					page = await browser.newPage()
				try {
					const identity = await openOwner(page, core.appId, core.url, true),
						sample = await recoverySample(retainedFile, core.appId, identity)
					await startOwnedSession(page, sample, core.url, 'new', 'acquisition')
					await expect
						.poll(() => page.evaluate(() => window.financeRestoreSessionRuntime.stats.opened))
						.toBe(1)
					await page.evaluate(
						({ interruption, operation }) => {
							const actor = window.financeRestoreSessionRuntime.actor
							const binding = {
								applicationId: operation.applicationId,
								environment: operation.environment,
								identityId: operation.identityId,
								operationId: operation.operationId,
								workspaceId: operation.destinationWorkspaceId,
								generation: 1
							}
							actor.send({ type: 'INVALIDATE', binding: { ...binding, generation: 2 } })
							if (actor.getSnapshot().status !== 'active')
								throw new Error('Stale invalidation stopped owner')
							actor.send({ type: 'CANCEL' })
							if (interruption === 'INVALIDATE') actor.send({ type: 'INVALIDATE', binding })
							else actor.send({ type: interruption })
							actor.send({ type: 'CANCEL' })
						},
						{ interruption, operation: sample.intent.operation }
					)
					expect(
						await page.evaluate(() => ({
							status: window.financeRestoreSessionRuntime.actor.getSnapshot().status,
							...window.financeRestoreSessionRuntime.stats
						}))
					).toMatchObject({ status: 'active', closeAttempts: 0, releases: 0 })
					await page.evaluate(() => window.financeRestoreSessionRuntime.releaseAcquisition())
					const result = await page.evaluate(() =>
						window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
					)
					expect(result.outcome).toBe(
						interruption === 'CANCEL'
							? 'cancelled'
							: interruption === 'SHUTDOWN'
								? 'closed'
								: 'invalidated'
					)
					expect(
						await page.evaluate(() => ({
							...window.financeRestoreSessionRuntime.stats,
							commits: window.financeRestoreSessionRuntime.commits()
						}))
					).toMatchObject({ acquisitions: 1, closeAttempts: 1, releases: 1, commits: [] })
				} finally {
					await browser.close()
					await core.stop()
				}
			},
			60_000
		)
		it.each(['open-rejected', 'commit-rejected'] satisfies ('open-rejected' | 'commit-rejected')[])(
			'session owner requires restart after permanent %s without replaying or claiming cleanup',
			async (fault) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const browser = await chromium.launch({ channel: 'chromium' }),
					page = await browser.newPage()
				try {
					const identity = await openOwner(page, core.appId, core.url, true),
						sample = await recoverySample(retainedFile, core.appId, identity)
					await startOwnedSession(page, sample, core.url, 'new', fault)
					const result = await page.evaluate(async () => {
						const api = window.financeRestoreRecovery,
							runtime = window.financeRestoreSessionRuntime
						await api.waitFor(runtime.actor, (state) => state.hasTag('restore-restart-required'))
						const before = { ...runtime.stats, commits: runtime.commits() }
						runtime.actor.send({ type: 'RETRY_RELEASE' })
						runtime.actor.send({ type: 'SHUTDOWN' })
						await Promise.resolve()
						return {
							before,
							after: { ...runtime.stats, commits: runtime.commits() },
							state: runtime.actor.getSnapshot().value,
							status: runtime.actor.getSnapshot().status
						}
					})
					expect(result.state).toBe('restartRequired')
					expect(result.status).toBe('active')
					expect(result.after).toEqual(result.before)
					expect(result.after).toMatchObject({ acquisitions: 1, closeAttempts: 0, releases: 0 })
					// A real document restart discards no journal and does not automatically resume writes.
					await page.reload()
					expect(await openOwner(page, core.appId, core.url, false)).toBe(identity)
					await startOwnedSession(page, sample, core.url, 'resume')
					const resumed = await page.evaluate(() =>
						window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
					)
					expect(resumed.outcome).toBe(fault === 'open-rejected' ? 'incomplete' : 'complete')
					expect(resumed.record?.intent.operation).toEqual(sample.intent.operation)
					if (fault === 'commit-rejected')
						expect(await retainedSource(page, sample)).toMatchObject({
							hash: sample.intent.archive.payloadSha256
						})
					else
						expect(
							await page.evaluate(() => window.financeRestoreSessionRuntime.commits())
						).toEqual([])
				} finally {
					await browser.close()
					await core.stop()
				}
			},
			60_000
		)
		it('file controller offers restart after a native crash and resumes the same destination after reload', async () => {
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const browser = await chromium.launch({ channel: 'chromium' }),
				page = await browser.newPage()
			try {
				const identity = await openOwner(page, core.appId, core.url, true)
				const first = await page.evaluate(
					async ({ file, appId, serverUrl }) => {
						const api = window.financeRestoreRecovery,
							session = window.financeRecoveryOwner
						let acquisitions = 0,
							closes = 0
						const actor = api
							.createActor(
								api.createWorkspaceRestoreController(undefined, async (config) => {
									acquisitions++
									const client = await window.financeRestoreIsolation.openAccountClient(config)
									return {
										...client,
										db: new Proxy(client.db, {
											get(target, key, receiver) {
												if (key === 'getAuthState')
													return () => {
														throw new Error('Injected native guard crash')
													}
												return Reflect.get(target, key, receiver)
											}
										}),
										shutdown: (settings) => {
											closes++
											return client.shutdown(settings)
										}
									}
								})
							)
							.start()
						const request = api.prepareWorkspaceRestoreFile(
							new File([new Uint8Array(file)], 'backup.dlf'),
							''
						)
						api.bindWorkspaceRestoreFile(request, session, { appId, serverUrl, environment: 'dev' })
						actor.send({ type: 'SUBMIT', request })
						await api.waitFor(
							actor,
							(state) => api.selectWorkspaceRestoreReport(state).view.canConfirm
						)
						const binding = actor.getSnapshot().context.binding
						actor.send({ type: 'CONFIRM' })
						await api.waitFor(
							actor,
							(state) => api.selectWorkspaceRestoreReport(state).view.canReload
						)
						actor.send({ type: 'DRAIN' })
						actor.send({ type: 'RETRY_RELEASE' })
						return {
							binding,
							acquisitions,
							closes,
							view: api.selectWorkspaceRestoreReport(actor.getSnapshot()).view,
							nativeStatus: actor.getSnapshot().context.native?.getSnapshot().status
						}
					},
					{ file: retainedFile, appId: core.appId, serverUrl: core.url }
				)
				expect(first).toMatchObject({
					acquisitions: 1,
					closes: 0,
					nativeStatus: 'error',
					view: {
						busy: true,
						editable: false,
						canReload: true,
						canRetryRelease: false,
						canCancel: false,
						message: 'failed'
					}
				})
				await page.reload()
				expect(await openOwner(page, core.appId, core.url, false)).toBe(identity)
				const resumed = await page.evaluate(
					async ({ file, appId, serverUrl }) => {
						const api = window.financeRestoreRecovery,
							actor = api.createActor(api.createWorkspaceRestoreController()).start(),
							request = api.prepareWorkspaceRestoreFile(
								new File([new Uint8Array(file)], 'backup.dlf'),
								''
							)
						api.bindWorkspaceRestoreFile(request, window.financeRecoveryOwner, {
							appId,
							serverUrl,
							environment: 'dev'
						})
						actor.send({ type: 'SUBMIT', request })
						await api.waitFor(
							actor,
							(state) => api.selectWorkspaceRestoreReport(state).view.canConfirm
						)
						const binding = actor.getSnapshot().context.binding
						actor.send({ type: 'CONFIRM' })
						await api.waitFor(actor, (state) => !api.selectWorkspaceRestoreReport(state).view.busy)
						const view = api.selectWorkspaceRestoreReport(actor.getSnapshot()).view
						actor.stop()
						return { binding, view }
					},
					{ file: retainedFile, appId: core.appId, serverUrl: core.url }
				)
				expect(resumed.binding).toEqual(first.binding)
				expect(resumed.view).toMatchObject({ message: 'done', canOpen: true, canReload: false })
			} finally {
				await browser.close()
				await core.stop()
			}
		}, 60_000)
		it.each(['rollback', 'close'] satisfies ('rollback' | 'close')[])(
			'session owner keeps resources after unconfirmed %s',
			async (fault) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const browser = await chromium.launch({ channel: 'chromium' }),
					page = await browser.newPage()
				try {
					const identity = await openOwner(page, core.appId, core.url, true),
						sample = await recoverySample(retainedFile, core.appId, identity)
					await startOwnedSession(page, sample, core.url, 'new', fault)
					if (fault === 'rollback')
						await page.evaluate(() => {
							const runtime = window.financeRestoreSessionRuntime
							return Promise.race([
								runtime.transactionOpened,
								window.financeRestoreRecovery.toPromise(runtime.actor).then((result) => {
									throw new Error('Owner stopped before opening transaction: ' + result.outcome)
								})
							])
						})
					else
						await expect
							.poll(() => page.evaluate(() => window.financeRestoreSessionRuntime.stats.opened))
							.toBe(1)
					await page.evaluate((fault) => {
						const runtime = window.financeRestoreSessionRuntime
						runtime.actor.send({ type: 'CANCEL' })
						if (fault === 'rollback') runtime.releaseTransaction()
						else runtime.releaseAcquisition()
					}, fault)
					await page.evaluate(async (fault) => {
						const api = window.financeRestoreRecovery,
							runtime = window.financeRestoreSessionRuntime
						await api.waitFor(runtime.actor, (snapshot) =>
							snapshot.matches(fault === 'rollback' ? 'rollbackBlocked' : 'clientBlocked')
						)
					}, fault)
					expect(
						await page.evaluate(() => ({
							status: window.financeRestoreSessionRuntime.actor.getSnapshot().status,
							...window.financeRestoreSessionRuntime.stats
						}))
					).toMatchObject({
						status: 'active',
						releases: 0,
						closeAttempts: fault === 'rollback' ? 0 : 1
					})
					await page.evaluate(() =>
						window.financeRestoreSessionRuntime.actor.send({ type: 'RETRY_RELEASE' })
					)
					expect(
						(
							await page.evaluate(() =>
								window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
							)
						).outcome
					).toBe('cancelled')
					expect(
						await page.evaluate(() => window.financeRestoreSessionRuntime.stats)
					).toMatchObject({
						releases: 1,
						closeAttempts: fault === 'rollback' ? 1 : 2,
						...(fault === 'rollback' ? { transactions: 1, rollbackAttempts: 3 } : {})
					})
				} finally {
					await browser.close()
					await core.stop()
				}
			},
			60_000
		)
		it('session owner does not create a missing resume destination', async () => {
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const browser = await chromium.launch({ channel: 'chromium' }),
				page = await browser.newPage()
			try {
				const identity = await openOwner(page, core.appId, core.url, true),
					sample = await recoverySample(retainedFile, core.appId, identity)
				await startOwnedSession(page, sample, core.url, 'resume')
				expect(
					await page.evaluate(() =>
						window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
					)
				).toEqual({ outcome: 'incomplete', record: undefined })
				expect(
					await page.evaluate(() => ({
						...window.financeRestoreSessionRuntime.stats,
						commits: window.financeRestoreSessionRuntime.commits()
					}))
				).toMatchObject({ acquisitions: 0, releases: 1, commits: [] })
			} finally {
				await browser.close()
				await core.stop()
			}
		})

		it('session owner drains an accepted commit before close and resumes without replay', async () => {
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const backend = await createJazzSession({
				appId: core.appId,
				app: isolationApp,
				permissions: isolationPermissions,
				serverUrl: core.url,
				driver: { type: 'memory' },
				initial: { backendSecret: core.backendSecret }
			})
			const observer = backend.getSnapshot().client?.db
			if (!observer) throw new Error('Missing independent authority')
			const proxy = createSilentJazzProxy(core.url),
				profile = await mkdtemp(resolve(tmpdir(), 'finance-restore-recovery-'))
			await proxy.listen(0)
			const context = await chromium.launchPersistentContext(profile, {
				channel: 'chromium',
				headless: true
			})
			try {
				const page = context.pages()[0] ?? (await context.newPage())
				await page.exposeFunction('pauseRecoveryReplies', () => proxy.pauseServerReplies())
				const identity = await openOwner(page, core.appId, proxy.url, true),
					sample = await recoverySample(retainedFile, core.appId, identity)
				await observeOwnerCatalog(page, sample.graph.workspace.id)
				await startOwnedSession(page, sample, proxy.url, 'new', 'commit')
				await expect
					.poll(
						async () =>
							(
								await observer.all(
									isolationApp.transactions.where({ organizationId: sample.graph.workspace.id }),
									{ tier: 'remote' }
								)
							).length,
						{ timeout: 10_000 }
					)
					.toBe(sample.graph.transactions.length)
				await page.evaluate(async () => {
					const api = window.financeRestoreRecovery,
						runtime = window.financeRestoreSessionRuntime
					runtime.actor.send({ type: 'CANCEL' })
					await api.waitFor(
						runtime.actor,
						(snapshot) =>
							snapshot.matches('waitingForPending') || snapshot.matches('settlingCommit')
					)
				})
				expect(
					await page.evaluate(() => ({
						...window.financeRestoreSessionRuntime.stats,
						status: window.financeRestoreSessionRuntime.actor.getSnapshot().status
					}))
				).toMatchObject({ status: 'active', closeAttempts: 0, releases: 0 })
				expect(
					await observer.all(
						isolationApp.organizationMembers.where({ organizationId: sample.graph.workspace.id }),
						{ tier: 'remote' }
					)
				).toEqual([])
				proxy.resume()
				expect(
					(
						await page.evaluate(() =>
							window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
						)
					).outcome
				).toBe('cancelled')
				expect(
					await page.evaluate(() => ({
						...window.financeRestoreSessionRuntime.stats,
						commits: window.financeRestoreSessionRuntime.commits().length
					}))
				).toMatchObject({ closeAttempts: 1, releases: 1, commits: 2 })
				await startOwnedSession(page, sample, proxy.url, 'resume')
				expect(
					await page.evaluate(() =>
						window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
					)
				).toMatchObject({ outcome: 'complete', record: { checkpoint: { kind: 'complete' } } })
				expect(
					await page.evaluate(() => window.financeRestoreSessionRuntime.commits().length)
				).toBe(1)
				const actual = await page.evaluate(async (sample) => {
					const api = window.financeRestoreRecovery,
						db = window.financeRecoveryOwner.getSnapshot().client?.db
					if (!db) throw new Error('Missing ordinary client')
					const rows = await api.readRecovery(
						db,
						api.recoveryQueries(sample.graph, sample.intent.operation.operationId),
						'remote'
					)
					return api.canonicalRecovery(rows.slice(1, 13))
				}, sample)
				expect(actual).toBe(canonicalRecovery(financeGraphRows(sample.graph)))
			} finally {
				proxy.resume()
				await context.close()
				await backend.close()
				await proxy.close()
				await core.stop()
				await rm(profile, { recursive: true, force: true })
			}
		}, 60_000)

		it('retained source access follows current roles and cannot be changed after publication', async () => {
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const browser = await chromium.launch({ channel: 'chromium' }),
				page = await browser.newPage()
			const readers: JazzSession<JazzClient>[] = []
			const makeStore = () => {
				let value: string | null = null
				return {
					read: async () => value,
					update: async (transform: (current: string | null) => string) => {
						value = transform(value)
					}
				} satisfies AccountStore
			}
			const makeReader = async (store: AccountStore) => {
				const session = await createJazzSession({
					appId: core.appId,
					app: isolationApp,
					permissions: isolationPermissions,
					serverUrl: core.url,
					driver: { type: 'memory' },
					store,
					initial: 'local-first'
				})
				readers.push(session)
				const state = session.getSnapshot()
				if (!state.account || !state.client) throw new Error('Missing real reader identity')
				state.client.db.onMutationError(() => {})
				return { session, db: state.client.db, identity: state.account.id }
			}
			try {
				const identity = await openOwner(page, core.appId, core.url, true),
					sample = await recoverySample(retainedFile, core.appId, identity)
				await startOwnedSession(page, sample, core.url, 'new')
				expect(
					(
						await page.evaluate(() =>
							window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
						)
					).outcome
				).toBe('complete')
				const readerStore = makeStore(),
					reader = await makeReader(readerStore),
					outsider = await makeReader(makeStore()),
					membershipId = crypto.randomUUID()
				expect(reader.identity).not.toBe(identity)
				expect(outsider.identity).not.toBe(reader.identity)
				expect(outsider.identity).not.toBe(identity)

				await page.evaluate(
					async ({ identity, membershipId, workspaceId }) => {
						const db = window.financeRecoveryOwner.getSnapshot().client?.db
						if (!db) throw new Error('Missing owner')
						await db
							.insert(
								window.financeRestoreIsolation.app.organizationMembers,
								{
									organizationId: workspaceId,
									userId: identity,
									role: 'viewer',
									accountAccessMode: 'all'
								},
								{ id: membershipId }
							)
							.wait({ tier: 'global' })
					},
					{ identity: reader.identity, membershipId, workspaceId: sample.graph.workspace.id }
				)
				expect(
					await reader.db.all(
						isolationApp.transactions.where({ organizationId: sample.graph.workspace.id }),
						{ tier: 'remote' }
					)
				).toHaveLength(sample.graph.transactions.length)
				const attachmentId = sample.graph.files[0]?.id
				if (!attachmentId) throw new Error('Missing ordinary attachment')
				expect(
					await reader.db.all(isolationApp.files.where({ id: attachmentId }), {
						tier: 'remote'
					})
				).toHaveLength(1)
				expect(
					await reader.db.all(isolationApp.files.where({ id: sample.graph.source.file.id }), {
						tier: 'remote'
					})
				).toEqual([])
				expect(
					await reader.db.all(
						isolationApp.fileParts.where({ fileId: sample.graph.source.file.id }),
						{ tier: 'remote' }
					)
				).toEqual([])
				expect(
					await outsider.db.all(isolationApp.files.where({ id: sample.graph.source.file.id }), {
						tier: 'remote'
					})
				).toEqual([])
				for (const target of [sample.graph.source.file.id, attachmentId]) {
					const organizationId = crypto.randomUUID(),
						operationId = crypto.randomUUID()
					await (
						await outsider.db.transaction((tx) => {
							tx.insert(
								isolationApp.organizations,
								{
									name: 'Foreign-pointer probe',
									kind: 'personal',
									defaultCurrency: 'USD',
									ownerId: outsider.identity,
									restoreOperationId: operationId
								},
								{ id: organizationId }
							)
							tx.insert(
								isolationApp.restoreOperations,
								{
									workspaceId: organizationId,
									sourceFileId: target,
									ownerId: outsider.identity,
									status: 'incomplete',
									payloadSha256: sample.intent.archive.payloadSha256,
									graphSha256: sample.intent.plan.expectedGraphSha256,
									workspaceName: 'Foreign-pointer probe',
									workspaceKind: 'personal',
									workspaceCurrency: 'USD'
								},
								{ id: operationId }
							)
						})
					).wait({ tier: 'global' })
					expect(
						await outsider.db.all(isolationApp.files.where({ id: target }), { tier: 'remote' })
					).toEqual([])
					expect(
						await outsider.db.all(isolationApp.fileParts.where({ fileId: target }), {
							tier: 'remote'
						})
					).toEqual([])
					await (
						await outsider.db.transaction((tx) => {
							tx.update(isolationApp.restoreOperations, operationId, { status: 'active' })
							tx.insert(isolationApp.organizationMembers, {
								organizationId,
								userId: outsider.identity,
								role: 'owner',
								accountAccessMode: 'all'
							})
						})
					).wait({ tier: 'global' })
					expect(
						await outsider.db.all(isolationApp.files.where({ id: target }), { tier: 'remote' })
					).toEqual([])
					expect(
						await outsider.db.all(isolationApp.fileParts.where({ fileId: target }), {
							tier: 'remote'
						})
					).toEqual([])
				}

				await reader.session.close()
				await page.evaluate(async (membershipId) => {
					const db = window.financeRecoveryOwner.getSnapshot().client?.db
					if (!db) throw new Error('Missing owner')
					await db
						.update(window.financeRestoreIsolation.app.organizationMembers, membershipId, {
							role: 'admin'
						})
						.wait({ tier: 'global' })
				}, membershipId)
				const admin = await makeReader(readerStore)
				expect(admin.identity).toBe(reader.identity)
				expect(
					await admin.db.all(isolationApp.files.where({ id: sample.graph.source.file.id }), {
						tier: 'remote'
					})
				).toEqual([sample.graph.source.file])
				expect(
					await admin.db.all(
						isolationApp.fileParts.where({ fileId: sample.graph.source.file.id }),
						{ tier: 'remote' }
					)
				).toHaveLength(sample.graph.source.parts.length)
				const firstPart = sample.graph.source.parts[0]
				if (!firstPart) throw new Error('Missing original source part')
				for (const write of [
					() =>
						admin.db.update(isolationApp.fileParts, firstPart.id, { data: new Uint8Array([9]) }),
					() => admin.db.delete(isolationApp.files, sample.graph.source.file.id),
					() =>
						admin.db.insert(isolationApp.fileParts, {
							fileId: sample.graph.source.file.id,
							partIndex: sample.graph.source.parts.length,
							sizeBytes: 1,
							data: new Uint8Array([9])
						})
				])
					await expect(write().wait({ tier: 'global' })).rejects.toBeInstanceOf(
						PersistedWriteRejectedError
					)
				await admin.db.all(
					isolationApp.organizationMembers.where({ organizationId: sample.graph.workspace.id }),
					{ tier: 'remote' }
				)

				await admin.db
					.update(isolationApp.organizationMembers, sample.graph.member.id, {
						role: 'viewer',
						accountAccessMode: 'selected'
					})
					.wait({ tier: 'global' })

				const revoked = await page.evaluate(
					async ({ sample, serverUrl }) => {
						const api = window.financeRestoreIsolation,
							account = window.financeRecoveryOwner.getSnapshot().account
						if (!account) throw new Error('Missing original identity')
						const client = await api.openAccountClient({
							appId: sample.intent.operation.applicationId,
							serverUrl,
							account,
							driver: { type: 'memory' }
						})
						try {
							return await Promise.all([
								client.db.all(
									api.app.accounts.where({ organizationId: sample.graph.workspace.id }),
									{ tier: 'remote' }
								),
								client.db.all(
									api.app.transactions.where({ organizationId: sample.graph.workspace.id }),
									{ tier: 'remote' }
								),
								client.db.all(api.app.files.where({ id: sample.graph.source.file.id }), {
									tier: 'remote'
								}),
								client.db.all(
									api.app.restoreOperations.where({ id: sample.intent.operation.operationId }),
									{ tier: 'remote' }
								)
							])
						} finally {
							await client.shutdown()
						}
					},
					{ sample, serverUrl: core.url }
				)
				expect(revoked).toEqual([[], [], [], []])
				await admin.db
					.update(isolationApp.organizationMembers, sample.graph.member.id, {
						role: 'owner',
						accountAccessMode: 'all'
					})
					.wait({ tier: 'global' })

				await admin.session.close()
				await page.evaluate(async (membershipId) => {
					const db = window.financeRecoveryOwner.getSnapshot().client?.db
					if (!db) throw new Error('Missing owner')
					await db
						.update(window.financeRestoreIsolation.app.organizationMembers, membershipId, {
							role: 'viewer'
						})
						.wait({ tier: 'global' })
				}, membershipId)
				const downgraded = await makeReader(readerStore)
				expect(
					await downgraded.db.all(isolationApp.files.where({ id: sample.graph.source.file.id }), {
						tier: 'remote'
					})
				).toEqual([])
				expect(await retainedSource(page, sample)).toEqual({
					file: sample.graph.source.file,
					hash: sample.intent.archive.payloadSha256,
					payload
				})
			} finally {
				for (const reader of readers) await reader.close()
				await browser.close()
				await core.stop()
			}
		}, 60_000)
		it('an empty workspace retains the original source and publishes without a financial batch', async () => {
			const rootOnly = {
				...payload,
				records: payload.records.filter((row) => row.type === 'organizations'),
				references: [],
				attachments: []
			}
			const file = await sealPlanPayload(rootOnly)
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const browser = await chromium.launch({ channel: 'chromium' }),
				page = await browser.newPage()
			try {
				const identity = await openOwner(page, core.appId, core.url, true),
					sample = await recoverySample(file, core.appId, identity)
				expect(sample.intent.plan.batches).toEqual([])
				await startOwnedSession(page, sample, core.url, 'new')
				expect(
					(
						await page.evaluate(() =>
							window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
						)
					).outcome
				).toBe('complete')
				expect(
					await page.evaluate(() => window.financeRestoreSessionRuntime.commits().length)
				).toBe(2)
				expect(await retainedSource(page, sample)).toEqual({
					file: sample.graph.source.file,
					hash: sample.intent.archive.payloadSha256,
					payload: rootOnly
				})
				const captured = await exportRestored(page, sample)
				expect(captured.result).toMatchObject({ outcome: 'exported' })
				const nextFile = captured.files[0]
				if (!nextFile) throw new Error('Missing empty-workspace subsequent backup')
				const second = await recoverySample(nextFile, core.appId, identity)
				expect(second.intent.plan.batches).toEqual([])
				expect(second.intent.plan.mappings).toHaveLength(1)
				await startOwnedSession(page, second, core.url, 'new')
				expect(
					(
						await page.evaluate(() =>
							window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
						)
					).outcome
				).toBe('complete')
				expect((await retainedSource(page, second)).payload).toEqual(await openExport(nextFile))
			} finally {
				await browser.close()
				await core.stop()
			}
		}, 60_000)

		it('retains a source spanning physical parts with exact UTF-8 contents', async () => {
			const transaction = payload.records.find((row) => row.type === 'transactions')
			if (!transaction) throw new Error('Missing source transaction')
			const expanded = {
				...payload,
				records: payload.records.map((row) =>
					row === transaction
						? ({
								...row,
								fields: { ...row.fields, memo: { kind: 'text', value: '€'.repeat(90_000) } }
							} satisfies ArchivePayload['records'][number])
						: row
				)
			}
			const file = await sealPlanPayload(expanded)
			const core = await startLocalJazzServer({
				appId: crypto.randomUUID(),
				schema: isolationApp,
				permissions: isolationPermissions,
				inMemory: true,
				allowLocalFirstAuth: true
			})
			const browser = await chromium.launch({ channel: 'chromium' }),
				page = await browser.newPage()
			try {
				const identity = await openOwner(page, core.appId, core.url, true),
					sample = await recoverySample(file, core.appId, identity)
				expect(sample.graph.source.parts.length).toBeGreaterThan(1)
				expect(sample.graph.source.parts.every((part) => part.sizeBytes <= 256 * 1024)).toBe(true)
				await startOwnedSession(page, sample, core.url, 'new')
				expect(
					(
						await page.evaluate(() =>
							window.financeRestoreRecovery.toPromise(window.financeRestoreSessionRuntime.actor)
						)
					).outcome
				).toBe('complete')
				expect(await retainedSource(page, sample)).toEqual({
					file: sample.graph.source.file,
					hash: sample.intent.archive.payloadSha256,
					payload: expanded
				})
				const captured = await exportRestored(page, sample)
				expect(captured.result).toMatchObject({ outcome: 'exported' })
				const nextFile = captured.files[0]
				if (!nextFile) throw new Error('Missing multi-part source backup')
				const subsequent = await openExport(nextFile)
				expect(financeBackupProfile.validate(subsequent)).toBe(true)
				expect(
					subsequent.attachments.find((file) => file.id === sample.graph.source.file.id)?.sha256
				).toBe(sample.intent.archive.payloadSha256)
			} finally {
				await browser.close()
				await core.stop()
			}
		}, 60_000)

		const cases = [
			{ name: 'chromium', engine: chromium },
			{ name: 'firefox', engine: firefox },
			{ name: 'webkit', engine: webkit }
		].flatMap((browser) =>
			['preparation', 'financial-graph', 'activation'].map((writeId) => ({
				...browser,
				writeId,
				fault: 'accepted'
			}))
		)
		cases.push({
			name: 'chromium',
			engine: chromium,
			writeId: 'preparation',
			fault: 'source-conflict'
		})

		cases.push({ name: 'chromium', engine: chromium, writeId: 'financial-graph', fault: 'unsent' })
		cases.push({
			name: 'chromium',
			engine: chromium,
			writeId: 'financial-graph',
			fault: 'conflict'
		})
		cases.push({
			name: 'chromium',
			engine: chromium,
			writeId: 'financial-graph',
			fault: 'cancelled'
		})
		cases.push({ name: 'chromium', engine: chromium, writeId: 'financial-graph', fault: 'closed' })
		cases.push({
			name: 'chromium',
			engine: chromium,
			writeId: 'financial-graph',
			fault: 'invalidated'
		})
		cases.push({
			name: 'chromium',
			engine: chromium,
			writeId: 'financial-graph',
			fault: 'local-receipt'
		})
		it.each(cases)(
			'$name recovers $writeId after $fault across a full browser restart',
			async ({ name, engine, writeId, fault }) => {
				const core = await startLocalJazzServer({
					appId: crypto.randomUUID(),
					schema: isolationApp,
					permissions: isolationPermissions,
					inMemory: true,
					allowLocalFirstAuth: true
				})
				const proxy = createSilentJazzProxy(core.url),
					profile = await mkdtemp(resolve(tmpdir(), 'finance-restore-recovery-'))
				const backend = await createJazzSession({
					appId: core.appId,
					app: isolationApp,
					permissions: isolationPermissions,
					serverUrl: core.url,
					driver: { type: 'memory' },
					initial: { backendSecret: core.backendSecret }
				})
				const observer = backend.getSnapshot().client?.db
				if (!observer) throw new Error('Missing independent serving authority')
				await proxy.listen(0)
				const options = { headless: true, ...(name === 'chromium' ? { channel: 'chromium' } : {}) }
				let context = await engine.launchPersistentContext(profile, options)
				try {
					let page = context.pages()[0] ?? (await context.newPage())
					await page.exposeFunction('pauseRecoveryReplies', () => {
						if (fault === 'unsent') proxy.silence()
						else proxy.pauseServerReplies()
					})
					const identity = await openOwner(page, core.appId, proxy.url, true)
					const sample = await recoverySample(retainedFile, core.appId, identity)
					await attach(page, sample, proxy.url, 1, writeId)
					expect((await journal(page, 'initialize')).outcome).toBe('initialized')
					if (name === 'chromium' && writeId === 'preparation') {
						expect(
							await page.evaluate(() => {
								const api = window.financeRestoreRecovery,
									runtime = window.financeRecoveryRuntime
								try {
									api.createRecoveryProbe(
										runtime.client.db,
										{
											...runtime.sample,
											intent: {
												...runtime.sample.intent,
												archive: { ...runtime.sample.intent.archive, payloadSha256: '0'.repeat(64) }
											}
										},
										runtime.archive
									)
									return false
								} catch {
									return true
								}
							})
						).toBe(true)
						await page.evaluate(() => {
							const api = window.financeRestoreRecovery,
								runtime = window.financeRecoveryRuntime
							const altered = {
								...runtime.sample,
								graph: {
									...runtime.sample.graph,
									accounts: runtime.sample.graph.accounts.map((row, index) =>
										index === 0 ? { ...row, name: 'Wrong expected graph' } : row
									)
								}
							}
							runtime.probe = api.createRecoveryProbe(runtime.client.db, altered, runtime.archive)
						})
						expect((await runWrite(page, 'preparation')).outcome).toBe('incomplete')
						expect(await page.evaluate(() => window.financeRecoveryRuntime.probe.commits)).toEqual(
							[]
						)
						expect((await journal(page, 'load')).record?.checkpoint).toMatchObject({
							current: { status: 'notIssued', issuance: 0 }
						})
						await page.evaluate((heldWriteId) => {
							const runtime = window.financeRecoveryRuntime
							runtime.probe = window.financeRestoreRecovery.createRecoveryProbe(
								runtime.client.db,
								runtime.sample,
								runtime.archive,
								heldWriteId
							)
						}, writeId)
					}
					if (writeId !== 'preparation')
						expect((await runWrite(page, 'preparation')).outcome).toBe('prepared')
					if (fault === 'local-receipt')
						await page.evaluate(() => {
							const writer = window.financeRecoveryRuntime.probe.writer,
								persist = writer.persistLocal
							// Preserve the real SDK durability effect, but lose its observation before journaling.
							writer.persistLocal = (write) =>
								persist(write).then(() => new Promise<void>(() => {}))
						})
					if (writeId === 'activation') {
						expect((await runWrite(page, 'financial-graph')).outcome).toBe('batchWritten')
						expect(await compare(page)).toMatchObject({ checkpoint: { kind: 'activating' } })
					}
					const pending = runWrite(page, writeId).catch(() => undefined)
					await expect
						.poll(
							async () => {
								const record = (await journal(page, 'load')).record
								if (
									record?.checkpoint.kind !== 'writing' &&
									record?.checkpoint.kind !== 'activating'
								)
									return undefined
								return record.checkpoint.current
							},
							{ timeout: 10_000 }
						)
						.toMatchObject({
							status: 'issued',
							writeId,
							transactionId: fault === 'local-receipt' ? null : expect.any(String),
							settlement: {
								local: fault === 'local-receipt' ? 'unobserved' : 'persisted',
								remote: 'unobserved'
							}
						})
					const before = parseRestoreJournalRecord((await journal(page, 'load')).record)
					expect(
						await page.evaluate(() =>
							JSON.stringify(window.financeRecoveryRuntime.actor?.getSnapshot())
						)
					).not.toContain('Exact restore')
					if (fault !== 'unsent')
						await expect
							.poll(
								async () => {
									if (writeId === 'financial-graph')
										return (
											await observer.all(
												isolationApp.transactions.where({
													organizationId: sample.graph.workspace.id
												}),
												{ tier: 'remote' }
											)
										).length
									if (writeId === 'activation')
										return (
											await observer.one(
												isolationApp.restoreOperations.where({
													id: sample.intent.operation.operationId
												}),
												{ tier: 'remote' }
											)
										)?.status
									return (
										await observer.all(
											isolationApp.restoreOperations.where({
												id: sample.intent.operation.operationId
											}),
											{ tier: 'remote' }
										)
									).length
								},
								{ timeout: 10_000 }
							)
							.toBe(
								writeId === 'financial-graph'
									? sample.graph.transactions.length
									: writeId === 'activation'
										? 'active'
										: 1
							)
					else
						expect(
							await observer.all(
								isolationApp.transactions.where({ organizationId: sample.graph.workspace.id }),
								{ tier: 'remote' }
							)
						).toEqual([])
					if (fault === 'source-conflict') {
						const part = (
							await observer.all(
								isolationApp.fileParts
									.where({ fileId: sample.graph.source.file.id })
									.orderBy('partIndex'),
								{ tier: 'remote' }
							)
						)[0]
						if (!part?.data) throw new Error('Missing original source bytes')
						const corrupted = new Uint8Array(part.data)
						corrupted[0] = (corrupted[0] ?? 0) ^ 1
						await observer
							.update(isolationApp.fileParts, part.id, { data: corrupted })
							.wait({ tier: 'global' })
					}

					if (fault === 'conflict') {
						const transaction = sample.graph.transactions[0]
						if (!transaction) throw new Error('Missing fixture transaction')
						await observer.all(isolationApp.transactions.where({ id: transaction.id }), {
							tier: 'remote'
						})
						await observer
							.update(isolationApp.transactions, transaction.id, {
								description: 'Independent corruption probe'
							})
							.wait({ tier: 'global' })
					}
					if (['cancelled', 'closed', 'invalidated'].includes(fault)) {
						await page.evaluate((fault) => {
							const runtime = window.financeRecoveryRuntime
							if (fault === 'invalidated') {
								runtime.actor?.send({
									type: 'INVALIDATE',
									binding: { ...runtime.binding, generation: runtime.binding.generation + 1 }
								})
								if (runtime.actor?.getSnapshot().status !== 'active')
									throw new Error('Unrelated invalidation cancelled the operation')
								runtime.actor.send({ type: 'INVALIDATE', binding: runtime.binding })
							} else runtime.actor?.send({ type: fault === 'closed' ? 'SHUTDOWN' : 'CANCEL' })
						}, fault)
						expect((await pending)?.outcome).toBe(fault)
						expect(
							await page.evaluate(() => window.financeRecoveryRuntime.probe.detached.length)
						).toBe(1)
						proxy.resume()
						await page.evaluate(async () => {
							const runtime = window.financeRecoveryRuntime,
								receipt = runtime.probe.detached[0]
							if (!receipt?.commit) throw new Error('Missing retained native commit')
							await receipt.acquisition
							await receipt.pending
							const write = await receipt.commit
							await write.wait({ tier: 'global' })
							runtime.probe.detached.shift()
							await runtime.client.shutdown()
						})
					}
					await context.close()
					await pending
					proxy.resume()
					context = await engine.launchPersistentContext(profile, options)
					page = context.pages()[0] ?? (await context.newPage())
					expect(await openOwner(page, core.appId, proxy.url, false)).toBe(identity)
					const rebuilt = await recoverySample(retainedFile, core.appId, identity, before.intent)
					expect(rebuilt).toEqual(sample)
					await attach(page, rebuilt, proxy.url, 2)
					if (fault === 'unsent') {
						// Browser Db startup is lazy: acquire the control scope to open the recovered replica.
						await page.evaluate(async () => {
							const runtime = window.financeRecoveryRuntime,
								app = window.financeRestoreIsolation.app
							await runtime.client.db.all(
								app.restoreOperations.where({ id: runtime.sample.intent.operation.operationId }),
								{ tier: 'remote' }
							)
						})
						await expect
							.poll(
								async () =>
									(
										await observer.all(
											isolationApp.transactions.where({
												organizationId: sample.graph.workspace.id
											}),
											{ tier: 'remote' }
										)
									).length,
								{ timeout: 10_000 }
							)
							.toBe(sample.graph.transactions.length)
					}
					const resumed = await runWrite(page, writeId)
					expect(await page.evaluate(() => window.financeRecoveryRuntime.probe.commits)).toEqual([])
					if (fault === 'conflict' || fault === 'source-conflict') {
						expect(resumed.outcome).toBe('conflict')
						expect(resumed.record).toEqual(before)
						expect(
							await observer.all(
								isolationApp.organizationMembers.where({
									organizationId: sample.graph.workspace.id
								}),
								{ tier: 'remote' }
							)
						).toEqual([])
						return
					}
					expect(resumed.outcome).toBe(
						writeId === 'preparation'
							? 'prepared'
							: writeId === 'activation'
								? 'complete'
								: 'batchWritten'
					)
					const checkpoint = resumed.record?.checkpoint
					const completion =
						checkpoint?.kind === 'complete'
							? checkpoint.activation
							: checkpoint && checkpoint.kind !== 'conflict'
								? checkpoint.completed.at(-1)
								: undefined
					expect(completion).toMatchObject({
						basis: 'remoteContentMatch',
						writeId,
						localPersistence: fault === 'local-receipt' ? 'unobserved' : 'persisted',
						attempt: {
							issuance: 1,
							settlement: {
								local: fault === 'local-receipt' ? 'unobserved' : 'persisted',
								remote: 'unobserved'
							}
						}
					})
					if (writeId === 'preparation') {
						const next = await runWrite(page, 'financial-graph')
						expect(next.outcome).toBe('batchWritten')
					}
					if (writeId !== 'activation') {
						expect(await compare(page)).toMatchObject({ checkpoint: { kind: 'activating' } })
						expect((await runWrite(page, 'activation')).outcome).toBe('complete')
					}
					expect(
						await observer.all(
							isolationApp.organizationMembers.where({ organizationId: sample.graph.workspace.id }),
							{ tier: 'remote' }
						)
					).toEqual([sample.graph.member])
					const fileIds = sample.graph.files.map((file) => file.id)
					expect(
						await observer.all(
							isolationApp.fileParts
								.where({ fileId: { in: fileIds } })
								.orderBy('fileId')
								.orderBy('partIndex'),
							{ tier: 'remote' }
						)
					).toEqual(
						sample.graph.parts.map((part) => ({ ...part, data: new Uint8Array(part.data) }))
					)
					const published = await page.evaluate(async () => {
						const api = window.financeRestoreRecovery,
							runtime = window.financeRecoveryRuntime
						const ordinary = window.financeRecoveryOwner.getSnapshot().client?.db
						if (!ordinary) throw new Error('Missing ordinary client')
						const snapshot = await api.readRecovery(
							ordinary,
							api.recoveryQueries(
								runtime.sample.graph,
								runtime.sample.intent.operation.operationId
							),
							'remote'
						)
						return { rows: api.canonicalRecovery(snapshot.slice(1, 13)), members: snapshot[13] }
					})
					expect(published).toEqual({
						rows: canonicalRecovery(financeGraphRows(sample.graph)),
						members: [sample.graph.member]
					})
					expect(await retainedSource(page, sample)).toEqual({
						file: sample.graph.source.file,
						hash: sample.intent.archive.payloadSha256,
						payload
					})

					expect(
						await Promise.all([
							observer.all(isolationApp.accountMemberships, { tier: 'remote' }),
							observer.all(isolationApp.profiles, { tier: 'remote' }),
							observer.all(isolationApp.simplefinConnections, { tier: 'remote' }),
							observer.all(isolationApp.simplefinAccountLinks, { tier: 'remote' }),
							observer.all(isolationApp.simplefinSyncAttempts, { tier: 'remote' }),
							observer.all(isolationApp.simplefinSyncAccountResults, { tier: 'remote' })
						])
					).toEqual([[], [], [], [], [], []])
				} finally {
					await context.close()
					await backend.close()
					await proxy.close()
					await core.stop()
					await rm(profile, { recursive: true, force: true })
				}
			},
			60_000
		)
	})
})

/** Rebuild solely from the checked original file and its saved durable intent. */
async function recoverySample(
	file: number[],
	applicationId: string,
	identityId: string,
	previous?: RestoreJournalIntent,
	observe?: (state: string) => void
): Promise<RecoverySample> {
	const opened = prepareArchiveOpen(new Uint8Array(file))
	const result = await toPromise(
		createActor(createArchiveEnvelopeMachine(), { input: { request: opened } }).start()
	)
	if (result.outcome !== 'integrityChecked') throw new Error('Restore file failed opening')
	const binding = {
		applicationId,
		environment: 'dev',
		identityId,
		workspaceId: result.archive.readPayload().source.workspaceId,
		operationId: previous?.operation.operationId ?? crypto.randomUUID(),
		generation: 0
	}
	const request = prepareFinanceRestorePlan(result.archive, binding, previous)
	try {
		const actor = createActor(financeRestorePlanningMachine, { input: { request } })
		actor.subscribe((snapshot) => observe?.(snapshot.value))
		const planned = await toPromise(actor.start())
		if (planned.outcome !== 'planned') throw new Error('Finance restore planning failed')
		const plan = structuredClone(planned.plan.read())
		expect(JSON.stringify(actor.getSnapshot())).not.toContain('Exact restore')
		return { ...plan, file, databaseName: 'finance-recovery-qualification' }
	} finally {
		request.release()
		result.archive.release()
		opened.release()
	}
}
