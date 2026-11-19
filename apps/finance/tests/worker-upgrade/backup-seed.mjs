import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { createJazz, createJazzClient, memory, acceptLocalFirstAuth } from 'jazz-tools/backend'
import { createActor, createAsyncLogic, toPromise } from 'xstate'
import { prepareJazzArchiveExport } from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'

// Run only inside the disposable alpha.60 project. Generate a real released v1
// archive before upgrading; alpha.66 must reopen these exact bytes independently.
const require = createRequire(import.meta.url)
assert.equal(require('jazz-tools/package.json').version, '2.0.0-alpha.60')
const sdk = createRequire(require.resolve('jazz-tools/package.json'))
const { build } = sdk('esbuild')
await build({
	stdin: {
		contents: `export { previousApp as app } from './src/lib/schema.js';
export { previousPermissions as permissions } from './src/lib/permissions.js';
export { readFinanceAuthority, readFinanceRelations, validateFinanceBackup } from './src/lib/backup/workspace.js';
export { financeBackupReader } from './src/lib/machines/workspaces/workspace-backup.js';`,
		resolveDir: process.cwd()
	},
	outfile: 'released-backup.mjs',
	bundle: true,
	packages: 'external',
	platform: 'node',
	format: 'esm'
})
const {
	app,
	permissions,
	readFinanceAuthority,
	readFinanceRelations,
	validateFinanceBackup,
	financeBackupReader
} = await import('./released-backup.mjs')
const target = process.argv[2]
if (!target) throw new Error('Retained archive output directory required')
const authority = createJazz({
	app,
	permissions,
	store: memory(),
	authenticate: acceptLocalFirstAuth
})
const server = createServer((request, response) => authority.nodeHandler(request, response))
const sessions = []
try {
	await authority.attach(server)
	await authority.ready()
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Missing archive fixture listener')
	const session = await createJazzClient({
		app,
		permissions,
		serverUrl: `http://127.0.0.1:${address.port}/jazz`,
		driver: { type: 'memory' },
		initial: 'local-first'
	})
	sessions.push(session)
	const state = session.getSnapshot()
	if (!state.client || !state.account) throw new Error('Missing archive fixture identity')
	const ids = Object.fromEntries(
		['organization', 'account', 'category', 'transaction', 'file'].map((name) => [
			name,
			crypto.randomUUID()
		])
	)
	ids.owner = state.account.id
	const tx = authority.db.beginTransaction(),
		organizationId = ids.organization
	tx.insert(
		app.organizations,
		{ name: 'Historical household', kind: 'personal', defaultCurrency: 'USD', ownerId: ids.owner },
		{ id: organizationId }
	)
	tx.insert(app.organizationMembers, {
		organizationId,
		userId: ids.owner,
		role: 'owner',
		accountAccessMode: 'all'
	})
	tx.insert(
		app.accounts,
		{ organizationId, name: 'Cash', kind: 'cash', currency: 'USD' },
		{ id: ids.account }
	)
	tx.insert(
		app.categories,
		{ organizationId, name: 'Expense', kind: 'expense', isSystem: false },
		{ id: ids.category }
	)
	tx.insert(
		app.transactions,
		{
			organizationId,
			accountId: ids.account,
			categoryId: ids.category,
			amountMinor: Number.MAX_SAFE_INTEGER,
			kind: 'expense',
			currency: 'USD',
			bookedOn: '2026-11-17',
			source: 'manual'
		},
		{ id: ids.transaction }
	)
	const bytes = new Uint8Array([0, 1, 127, 255])
	tx.insert(
		app.files,
		{
			transactionId: ids.transaction,
			fileName: 'historical.bin',
			mimeType: 'application/octet-stream',
			sizeBytes: bytes.length
		},
		{ id: ids.file }
	)
	tx.insert(app.transactionAttachments, { transactionId: ids.transaction, fileId: ids.file })
	tx.insert(app.fileParts, { fileId: ids.file, partIndex: 0, sizeBytes: bytes.length, data: bytes })
	await tx.commit().wait({ tier: 'global' })
	const reader = financeBackupReader.provide({
		actors: {
			authority: createAsyncLogic({ run: ({ input }) => readFinanceAuthority(input, app) }),
			relations: createAsyncLogic({ run: ({ input }) => readFinanceRelations(input) })
		}
	})
	const files = []
	const request = prepareJazzArchiveExport({
		db: state.client.db,
		profile: { id: 'delightful.finance.workspace', version: 1, validate: validateFinanceBackup },
		binding: {
			applicationId: 'delightful-finances',
			environment: 'disposable',
			identityId: ids.owner,
			workspaceId: organizationId,
			operationId: crypto.randomUUID(),
			generation: 0
		},
		protection: { kind: 'none' },
		isCurrent: () => true,
		handoff: {
			dispatch: async (file) => {
				files.push(file.copyBytes())
				return 'dispatched'
			}
		}
	})
	try {
		const result = await toPromise(
			createActor(createJazzArchiveExportMachine(reader), { input: { request } }).start()
		)
		assert.equal(result.outcome, 'exported')
		assert.equal(files.length, 1)
		await writeFile(join(target, 'retained-backup.dlf'), files[0])
		await writeFile(
			join(target, 'retained-backup.json'),
			JSON.stringify({ sdk: '2.0.0-alpha.60', ids }) + '\n'
		)
	} finally {
		await request.release()
	}
} finally {
	for (const session of sessions) await session.close()
	await authority.close()
	server.closeAllConnections()
	if (server.listening) await new Promise((resolve) => server.close(resolve))
}
