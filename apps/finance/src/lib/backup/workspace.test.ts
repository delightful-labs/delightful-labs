import { prepareBackupSubmission, takeBackupProtection } from './submission.js'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
	createJazzClient,
	createJazz,
	memory,
	acceptLocalFirstAuth,
	type JazzClient
} from 'jazz-tools/backend'
import { createServer } from 'node:http'
import type { JazzSession } from 'jazz-tools/client'
import type { Db } from 'jazz-tools'
import {
	prepareJazzArchiveExport,
	type JazzArchiveReaderInput,
	type ArchiveHandoffFile
} from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import type { ArchivePayload } from 'delightful-local-first/backup/archive'
import { app } from '../schema.js'
import permissions from '../permissions.js'
import {
	financeBackupReader,
	createWorkspaceBackupMachine,
	selectWorkspaceBackup,
	type BackupObservation
} from '../machines/workspaces/workspace-backup.js'
import { encodeAttachmentBytes, financeBackupProfile, readFinanceMetadata } from './workspace.js'
import {
	createActor,
	toPromise,
	waitFor,
	createAsyncLogic,
	initialTransition,
	transition,
	type InputFrom
} from 'xstate'

let authority: ReturnType<typeof createJazz>,
	server: ReturnType<typeof createServer>,
	db: Db,
	writer: Db,
	identityId: string
const sessions: JazzSession<JazzClient>[] = []
beforeAll(async () => {
	authority = createJazz({ app, permissions, store: memory(), authenticate: acceptLocalFirstAuth })
	server = createServer((request, response) => authority.nodeHandler(request, response))
	await authority.attach(server)
	await authority.ready()
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Missing disposable backup listener')
	const session = await createJazzClient({
		app,
		permissions,
		serverUrl: `http://127.0.0.1:${address.port}/jazz`,
		driver: { type: 'memory' },
		initial: 'local-first'
	})
	sessions.push(session)
	const owner = session.getSnapshot()
	if (!owner.client || !owner.account) throw new Error('Disposable backup client unavailable')
	db = owner.client.db
	writer = authority.db
	identityId = owner.account.id
	db.onMutationError(() => {})
}, 30000)
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
	for (const session of sessions) await session.close()
	await authority?.close()
	server?.closeAllConnections()
	if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
})
async function seed(scope: 'complete' | 'ownership' = 'complete') {
	const g = {
		organization: crypto.randomUUID(),
		profile: crypto.randomUUID(),
		member: crypto.randomUUID(),
		expenseAccount: crypto.randomUUID(),
		incomeAccount: crypto.randomUUID(),
		archivedAccount: crypto.randomUUID(),
		expenseCategory: crypto.randomUUID(),
		incomeCategory: crypto.randomUUID(),
		tag: crypto.randomUUID(),
		expense: crypto.randomUUID(),
		income: crypto.randomUUID(),
		checkTransaction: crypto.randomUUID(),
		check: crypto.randomUUID(),
		unassociatedCheck: crypto.randomUUID(),
		transfer: crypto.randomUUID(),
		batch: crypto.randomUUID(),
		file: crypto.randomUUID(),
		part: crypto.randomUUID(),
		connection: crypto.randomUUID(),
		attempt: crypto.randomUUID()
	}
	const tx = writer.beginTransaction(),
		organizationId = g.organization
	tx.insert(
		app.organizations,
		{ name: 'Exact household', kind: 'personal', defaultCurrency: 'USD', ownerId: identityId },
		{ id: organizationId }
	)
	tx.insert(
		app.profiles,
		{
			userId: identityId,
			displayName: 'Visible person',
			avatarData: new Uint8Array([99]),
			avatarMimeType: 'image/png'
		},
		{ id: g.profile }
	)
	tx.insert(
		app.organizationMembers,
		{
			organizationId,
			userId: identityId,
			profileId: g.profile,
			role: 'owner',
			accountAccessMode: 'all'
		},
		{ id: g.member }
	)
	if (scope === 'ownership') {
		await tx.commit().wait({ tier: 'global' })
		return g
	}
	for (const [id, name, archivedAt] of [
		[g.expenseAccount, 'Cash', undefined],
		[g.incomeAccount, 'Bank', undefined],
		[g.archivedAccount, 'Archived', new Date(0)]
	] satisfies [string, string, Date | undefined][]) {
		tx.insert(
			app.accounts,
			{
				organizationId,
				name,
				kind: 'cash',
				currency: 'USD',
				...(archivedAt ? { archivedAt } : {})
			},
			{ id }
		)
	}
	tx.insert(app.accountMemberships, {
		organizationId,
		userId: identityId,
		accountId: g.expenseAccount,
		access: 'write',
		canDelete: true
	})
	tx.insert(
		app.categories,
		{ organizationId, name: 'Expense', kind: 'expense', isSystem: true },
		{ id: g.expenseCategory }
	)
	tx.insert(
		app.categories,
		{ organizationId, name: 'Income', kind: 'income', isSystem: false },
		{ id: g.incomeCategory }
	)
	tx.insert(
		app.tags,
		{
			organizationId,
			name: '  exact tag  ',
			kind: 'expense',
			categoryId: g.expenseCategory,
			archivedAt: new Date(1)
		},
		{ id: g.tag }
	)
	tx.insert(app.transactionBatches, { organizationId, name: 'Batch' }, { id: g.batch })
	tx.insert(app.batchTemplates, { organizationId, name: 'Template' })
	tx.insert(
		app.checks,
		{
			organizationId,
			accountId: g.expenseAccount,
			checkNumber: '001',
			checkDate: '2026-11-01',
			payerName: 'Exact payer'
		},
		{ id: g.check }
	)
	tx.insert(
		app.checks,
		{ organizationId, accountId: g.expenseAccount, checkNumber: '002', checkDate: '2026-11-02' },
		{ id: g.unassociatedCheck }
	)
	tx.insert(
		app.transactions,
		{
			organizationId,
			accountId: g.expenseAccount,
			categoryId: g.expenseCategory,
			kind: 'expense',
			currency: 'USD',
			amountMinor: 12345,
			bookedOn: '2026-11-01',
			description: '  Exact description  ',
			memo: 'private finance content',
			source: 'manual',
			internalTransferId: g.transfer,
			batchId: g.batch
		},
		{ id: g.expense }
	)
	tx.insert(
		app.transactions,
		{
			organizationId,
			accountId: g.incomeAccount,
			categoryId: g.incomeCategory,
			kind: 'income',
			currency: 'USD',
			amountMinor: 12345,
			bookedOn: '2026-11-01',
			source: 'simplefin',
			externalId: 'provider-exact',
			internalTransferId: g.transfer
		},
		{ id: g.income }
	)
	tx.insert(
		app.transactions,
		{
			organizationId,
			accountId: g.expenseAccount,
			categoryId: g.expenseCategory,
			kind: 'expense',
			currency: 'USD',
			amountMinor: 100,
			bookedOn: '2026-11-01',
			source: 'manual',
			paymentMethod: 'check',
			checkId: g.check
		},
		{ id: g.checkTransaction }
	)
	tx.insert(
		app.internalTransfers,
		{
			organizationId,
			expenseTransactionId: g.expense,
			incomeTransactionId: g.income,
			expenseAccountId: g.expenseAccount,
			incomeAccountId: g.incomeAccount,
			expenseAmountMinor: 12345,
			incomeAmountMinor: 12345,
			expenseCurrency: 'USD',
			incomeCurrency: 'USD'
		},
		{ id: g.transfer }
	)
	tx.insert(app.transactionTags, { organizationId, transactionId: g.expense, tagId: g.tag })
	tx.insert(
		app.files,
		{
			transactionId: g.expense,
			fileName: 'receipt.bin',
			mimeType: 'application/octet-stream',
			sizeBytes: 8
		},
		{ id: g.file }
	)
	tx.insert(app.transactionAttachments, { transactionId: g.expense, fileId: g.file })
	tx.insert(
		app.fileParts,
		{ fileId: g.file, partIndex: 0, sizeBytes: 4, data: new Uint8Array([0, 1, 127, 255]) },
		{ id: g.part }
	)
	tx.insert(app.fileParts, {
		fileId: g.file,
		partIndex: 1,
		sizeBytes: 4,
		data: new Uint8Array([9, 8, 7, 6])
	})
	tx.insert(
		app.simplefinConnections,
		{
			organizationId,
			ownerId: identityId,
			accessUrl: 'SECRET_ACCESS_URL',
			ciphertext: 'SECRET_CIPHERTEXT',
			credentialId: 'SECRET_CREDENTIAL',
			prfSalt: 'SECRET_SALT',
			iv: 'SECRET_IV',
			credentialVersion: 1,
			lastError: 'SECRET_PROVIDER_ERROR',
			status: 'active',
			claimedAt: new Date(0),
			lastOutcome: 'succeeded',
			importedCount: 1,
			existingCount: 0,
			omittedCount: 0
		},
		{ id: g.connection }
	)
	tx.insert(app.simplefinAccountLinks, {
		organizationId,
		accountId: g.incomeAccount,
		connectionId: g.connection,
		simplefinAccountId: 'provider-account',
		availableBalance: '123.4500'
	})
	tx.insert(
		app.simplefinSyncAttempts,
		{
			organizationId,
			connectionId: g.connection,
			initiatedBy: identityId,
			startedAt: new Date(0),
			finishedAt: new Date(1),
			outcome: 'succeeded',
			importSettlement: 'confirmed',
			importedCount: 1,
			existingCount: 0,
			omittedCount: 0
		},
		{ id: g.attempt }
	)
	tx.insert(app.simplefinSyncAccountResults, {
		organizationId,
		attemptId: g.attempt,
		accountId: g.incomeAccount,
		accountName: 'Bank',
		outcome: 'succeeded',
		importedCount: 1,
		existingCount: 0,
		omittedCount: 0
	})
	await tx.commit().wait({ tier: 'global' })
	return g
}
function options(g: Awaited<ReturnType<typeof seed>>, password?: string) {
	const files: Uint8Array[] = []
	return {
		files,
		value: {
			db,
			profile: financeBackupProfile,
			binding: {
				applicationId: 'delightful-finances',
				environment: 'disposable',
				identityId,
				workspaceId: g.organization,
				operationId: crypto.randomUUID(),
				generation: 0
			},
			protection: password ? { kind: 'password', password } : { kind: 'none' },
			isCurrent: () => true,
			handoff: {
				dispatch: vi.fn(async (file: ArchiveHandoffFile): Promise<'dispatched'> => {
					files.push(file.copyBytes())
					return 'dispatched' satisfies 'dispatched'
				})
			}
		}
	} satisfies { files: Uint8Array[]; value: Parameters<typeof prepareJazzArchiveExport>[0] }
}
async function open(bytes: Uint8Array, password?: string) {
	const request = prepareArchiveOpen(bytes, password),
		actor = createActor(createArchiveEnvelopeMachine(), { input: { request } }).start(),
		result = await toPromise(actor)
	if (result.outcome !== 'integrityChecked') throw new Error('Retained file did not reopen')
	const payload = result.archive.readPayload()
	result.archive.release()
	return payload
}
function capture(
	g: Awaited<ReturnType<typeof seed>>,
	input = options(g),
	reader = financeBackupReader
) {
	const request = prepareJazzArchiveExport(input.value),
		actor = createActor(createJazzArchiveExportMachine(reader), { input: { request } }).start()
	return { actor, request, ...input }
}
describe('Finance native backup', { timeout: 30_000 }, () => {
	it.each([0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 8 * 1024 * 1024])(
		'encodes %i attachment bytes exactly, including padding and chunk boundaries',
		(length) => {
			const bytes = Uint8Array.from({ length }, (_, index) => index % 256)
			expect(encodeAttachmentBytes(bytes)).toBe(Buffer.from(bytes).toString('base64'))
		}
	)
	it.each([undefined, 'private-backup-password'])(
		'captures every released type and exact bytes with protection %s',
		async (password) => {
			const graph = await seed(),
				before = await db.all(
					app.transactions
						.where({ organizationId: graph.organization })
						.select('*', '$createdAt', '$updatedAt', '$createdBy', '$updatedBy'),
					{ tier: 'remote' }
				),
				h = capture(graph, options(graph, password))
			expect(await toPromise(h.actor)).toMatchObject({ outcome: 'exported', handoff: 'dispatched' })
			const file = h.files[0]
			if (!file) throw new Error('Missing file')
			const payload = await open(file, password)
			expect(payload.profile).toEqual({ id: 'delightful.finance.workspace', version: 2 })
			expect(payload.coverage.recordTypes).toContain('sourceDocuments')
			expect(financeBackupProfile.validate(payload)).toBe(true)
			expect(new Set([...payload.records, ...payload.references].map((row) => row.type)).size).toBe(
				19
			)
			expect(payload.records.find((row) => row.id === graph.expense)?.fields).toMatchObject({
				amountMinor: { kind: 'integer', value: '12345' },
				description: { kind: 'text', value: '  Exact description  ' },
				sourceCreatedAt: { kind: 'timestamp' }
			})
			expect(
				payload.records.find((row) => row.id === graph.archivedAccount)?.fields.archivedAt
			).toEqual({ kind: 'timestamp', value: new Date(0).toISOString() })
			expect(payload.records.filter((row) => row.type === 'checks')).toHaveLength(2)
			expect(Buffer.from(payload.attachments[0]?.data ?? '', 'base64')).toEqual(
				Buffer.from([0, 1, 127, 255, 9, 8, 7, 6])
			)
			expect(
				payload.records.some(
					(row) => row.type.startsWith('simplefin') || row.type === 'organizationMembers'
				)
			).toBe(false)
			expect(JSON.stringify(payload)).not.toMatch(
				/SECRET_|avatarData|avatarMimeType|credentialVersion|accessUrl|ciphertext|lastError/
			)
			expect(JSON.stringify(h.actor.getSnapshot())).not.toMatch(
				/private-backup-password|private finance content|Exact description/
			)
			expect(
				await db.all(
					app.transactions
						.where({ organizationId: graph.organization })
						.select('*', '$createdAt', '$updatedAt', '$createdBy', '$updatedBy'),
					{ tier: 'remote' }
				)
			).toEqual(before)
			await expect(h.request.release()).resolves.toBeUndefined()
		}
	)
	it.each([0, 2])(
		'captures a workspace with %i attachments without skipping files',
		async (count) => {
			const g = await seed(),
				expected = new Map<string, Uint8Array>([
					[g.file, new Uint8Array([0, 1, 127, 255, 9, 8, 7, 6])]
				]),
				tx = writer.beginTransaction()
			if (count === 0) {
				const links = await writer.all(app.transactionAttachments.where({ fileId: g.file })),
					parts = await writer.all(app.fileParts.where({ fileId: g.file }))
				for (const link of links) tx.delete(app.transactionAttachments, link.id)
				for (const part of parts) tx.delete(app.fileParts, part.id)
				tx.delete(app.files, g.file)
				expected.clear()
			} else {
				const id = crypto.randomUUID(),
					bytes = new Uint8Array([255, 0, 42, 17, 11, 10])
				tx.insert(
					app.files,
					{
						transactionId: g.expense,
						fileName: 'second-receipt.bin',
						mimeType: 'application/octet-stream',
						sizeBytes: bytes.length
					},
					{ id }
				)
				tx.insert(app.transactionAttachments, { transactionId: g.expense, fileId: id })
				for (let index = 0; index < 2; index++) {
					const data = bytes.slice(index * 3, index * 3 + 3)
					tx.insert(app.fileParts, { fileId: id, partIndex: index, sizeBytes: data.length, data })
				}
				expected.set(id, bytes)
			}
			await tx.commit().wait({ tier: 'global' })
			const h = capture(g)
			expect(await toPromise(h.actor)).toMatchObject({ outcome: 'exported' })
			const file = h.files[0]
			if (!file) throw new Error('Missing file')
			const payload = await open(file)
			expect(financeBackupProfile.validate(payload)).toBe(true)
			expect(payload.attachments).toHaveLength(count)
			for (const attachment of payload.attachments) {
				expect(expected.has(attachment.id)).toBe(true)
				expect(new Uint8Array(Buffer.from(attachment.data, 'base64'))).toEqual(
					expected.get(attachment.id)
				)
			}
		}
	)
	it.each([
		'missingPart',
		'wrongSize',
		'wrongIndex',
		'wrongBytes',
		'oversize',
		'legacyCheck'
	] satisfies (
		'missingPart' | 'wrongSize' | 'wrongIndex' | 'wrongBytes' | 'oversize' | 'legacyCheck'
	)[])('rejects incomplete or unsupported source %s', async (kind) => {
		const g = await seed()
		if (kind === 'missingPart') await writer.delete(app.fileParts, g.part).wait({ tier: 'global' })
		if (kind === 'wrongSize')
			await writer.update(app.fileParts, g.part, { sizeBytes: 3 }).wait({ tier: 'global' })
		if (kind === 'wrongIndex')
			await writer.update(app.fileParts, g.part, { partIndex: 4 }).wait({ tier: 'global' })
		if (kind === 'wrongBytes')
			await writer
				.update(app.fileParts, g.part, { data: new Uint8Array([1, 2, 3]) })
				.wait({ tier: 'global' })
		if (kind === 'oversize')
			await writer
				.update(app.files, g.file, { sizeBytes: 8 * 1024 * 1024 + 1 })
				.wait({ tier: 'global' })
		if (kind === 'legacyCheck')
			await writer
				.update(app.transactions, g.expense, { checkDetailsId: crypto.randomUUID() })
				.wait({ tier: 'global' })
		const h = capture(g)
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			archiveProduced: false,
			handoff: 'notStarted'
		})
		expect(h.value.handoff.dispatch).not.toHaveBeenCalled()
	})

	it.each([{ records: 5 }, { attachmentBytes: 4 }, { totalAttachmentBytes: 4 }])(
		'enforces the reduced capture budget %j',
		async (limits) => {
			const g = await seed(),
				input = options(g),
				request = prepareJazzArchiveExport({ ...input.value, limits })
			const actor = createActor(createJazzArchiveExportMachine(financeBackupReader), {
				input: { request }
			}).start()
			expect(await toPromise(actor)).toMatchObject({
				outcome: 'failed',
				archiveProduced: false,
				handoff: 'notStarted'
			})
			expect(input.files).toHaveLength(0)
		}
	)
	it('preserves owner access when the inert account-access field is selected', async () => {
		const g = await seed()
		await writer
			.update(app.organizationMembers, g.member, { accountAccessMode: 'selected' })
			.wait({ tier: 'global' })
		const h = capture(g)
		expect(await toPromise(h.actor)).toMatchObject({ outcome: 'exported' })
	})
	it('requires both workspace ownership and an owner membership', async () => {
		const g = await seed()
		await writer
			.update(app.organizationMembers, g.member, { role: 'admin' })
			.wait({ tier: 'global' })
		const h = capture(g)
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			code: 'permissionDenied',
			archiveProduced: false
		})
		expect(h.files).toHaveLength(0)
	})
	it('discards an exclusive conflict and allows a fresh explicit attempt', async () => {
		const g = await seed('ownership'),
			reached = Promise.withResolvers<void>(),
			resume = Promise.withResolvers<void>()
		const reader = financeBackupReader.provide({
			actors: {
				metadata: createAsyncLogic<void, JazzArchiveReaderInput>({
					run: async ({ input }) => {
						await readFinanceMetadata(input)
						if (input.mode === 'capture') {
							reached.resolve()
							await resume.promise
						}
					}
				})
			}
		})
		const h = capture(g, options(g), reader)
		await Promise.race([
			reached.promise,
			toPromise(h.actor).then((result) => {
				throw new Error('Capture ended before pause: ' + result.outcome)
			})
		])
		await writer
			.update(app.organizations, g.organization, { name: 'Changed remotely' })
			.wait({ tier: 'global' })
		// The authority has accepted the conflicting write; let it validate the stale capture.
		resume.resolve()
		expect(await toPromise(h.actor)).toMatchObject({
			outcome: 'failed',
			code: 'sourceChanged',
			archiveProduced: false
		})
		const fresh = capture(g)
		expect(await toPromise(fresh.actor)).toMatchObject({ outcome: 'exported' })
		const file = fresh.files[0]
		if (!file) throw new Error('Missing fresh backup')
		expect(
			(await open(file)).records.find((row) => row.id === g.organization)?.fields.name
		).toEqual({
			kind: 'text',
			value: 'Changed remotely'
		})
	})
	it('rejects profile tag substitution, unknown fields, broken references and unsafe money', async () => {
		const g = await seed(),
			h = capture(g)
		await toPromise(h.actor)
		const file = h.files[0]
		if (!file) throw new Error('Missing file')
		const payload = await open(file)
		const mutate = (fields: ArchivePayload['records'][number]['fields']) => ({
			...payload,
			records: payload.records.map((row) =>
				row.id === g.expense ? { ...row, fields: { ...row.fields, ...fields } } : row
			)
		})
		expect(
			financeBackupProfile.validate(mutate({ amountMinor: { kind: 'text', value: '12345' } }))
		).toBe(false)
		expect(
			financeBackupProfile.validate(
				mutate({ amountMinor: { kind: 'integer', value: '9007199254740992' } })
			)
		).toBe(false)
		expect(
			financeBackupProfile.validate(
				mutate({ accountId: { kind: 'reference', type: 'accounts', id: crypto.randomUUID() } })
			)
		).toBe(false)
		expect(
			financeBackupProfile.validate(mutate({ ciphertext: { kind: 'text', value: 'secret' } }))
		).toBe(false)
	})
	it('models password validation, cancellation, shutdown and scope invalidation without retaining secrets', async () => {
		const g = await seed(),
			started = Promise.withResolvers<void>(),
			finish = Promise.withResolvers<void>()
		let facts: BackupObservation = {
			identityId,
			workspaceId: g.organization,
			membershipId: g.member,
			memberUserId: identityId,
			ownerId: identityId,
			role: 'owner',
			access: 'all',
			sessionReady: true,
			attached: true,
			loading: false,
			failed: false
		}
		const actor = createActor(
			createWorkspaceBackupMachine({
				db,
				environment: 'disposable',
				observe: () => facts,
				handoff: {
					async dispatch() {
						started.resolve()
						await finish.promise
						return 'dispatched'
					}
				}
			}),
			{ input: {} }
		).start()
		actor.send({ type: 'SUBMIT', submission: prepareBackupSubmission('password', '') })
		expect(selectWorkspaceBackup(actor.getSnapshot()).message).toBe('password')
		actor.send({
			type: 'SUBMIT',
			submission: prepareBackupSubmission('password', 'do-not-retain-this-password')
		})
		await started.promise
		expect(JSON.stringify(actor.getSnapshot())).not.toContain('do-not-retain-this-password')
		actor.send({ type: 'CANCEL' })
		facts = { ...facts, workspaceId: crypto.randomUUID() }
		actor.send({ type: 'OBSERVE', facts })
		facts = { ...facts, workspaceId: g.organization }
		actor.send({ type: 'OBSERVE', facts })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'CANCEL' })
		expect(actor.getSnapshot().status).toBe('active')
		finish.resolve()
		await toPromise(actor)
		expect(actor.getSnapshot().status).toBe('done')
	})
	it.each(['normal', 'crash', 'closing', 'changing'])(
		'retains export custody after failed release during %s',
		async (mode) => {
			const g = await seed(),
				entered = Promise.withResolvers<void>(),
				proceed = Promise.withResolvers<void>(),
				releasing = Promise.withResolvers<void>(),
				releaseGate = Promise.withResolvers<void>()
			const facts: BackupObservation = {
				identityId,
				workspaceId: g.organization,
				membershipId: g.member,
				memberUserId: identityId,
				ownerId: identityId,
				role: 'owner',
				access: 'all',
				sessionReady: true,
				attached: true,
				loading: false,
				failed: false
			}
			const begin = db.beginSerializableTransaction.bind(db)
			let rollback: (() => Promise<boolean>) | undefined
			const rollbackAttempt = vi.fn(async () => false)
			vi.spyOn(db, 'beginSerializableTransaction').mockImplementation(() => {
				const transaction = begin()
				const nativeRollback = transaction.rollback.bind(transaction)
				rollback = () => Promise.resolve(nativeRollback())
				vi.spyOn(transaction, 'rollback').mockImplementation(rollbackAttempt)
				return transaction
			})
			const reader = financeBackupReader.provide({
				actors: {
					metadata: createAsyncLogic<void, JazzArchiveReaderInput>({
						run: async ({ input }) => {
							await readFinanceMetadata(input)
							if (input.mode !== 'capture') return
							entered.resolve()
							await proceed.promise
							throw new Error('Injected capture failure')
						}
					})
				}
			})
			const exporter = createJazzArchiveExportMachine(reader)
			const transition = exporter.transition.bind(exporter)
			vi.spyOn(exporter, 'transition').mockImplementation((...args) => {
				if (mode !== 'normal' && args[1].type === 'CANCEL')
					throw new Error('Injected export calculation crash')
				return transition(...args)
			})

			const actor = createActor(
				createWorkspaceBackupMachine({
					db,
					environment: 'test',
					observe: () => facts,
					handoff: { dispatch: async () => 'rejected' }
				}).provide({
					actors: {
						export: exporter,
						release: createAsyncLogic<
							void,
							{
								request:
									| import('delightful-local-first/backend/jazz/backup').JazzArchiveExportRequest
									| undefined
							}
						>({
							run: async ({ input }) => {
								releasing.resolve()
								await releaseGate.promise
								await input.request?.release()
							}
						})
					}
				}),
				{ input: {} }
			).start()
			try {
				actor.send({ type: 'SUBMIT', submission: prepareBackupSubmission('none', '') })
				await entered.promise
				const request = actor.getSnapshot().context.request
				proceed.resolve()
				if (mode !== 'normal') {
					actor.send({ type: 'CANCEL' })
					await releasing.promise
					if (mode === 'closing') actor.send({ type: 'SHUTDOWN' })
					if (mode === 'changing')
						actor.send({ type: 'OBSERVE', facts: { ...facts, workspaceId: crypto.randomUUID() } })
					releaseGate.resolve()
				}
				await waitFor(actor, (state) => selectWorkspaceBackup(state).canReload)
				expect(selectWorkspaceBackup(actor.getSnapshot())).toMatchObject({
					editable: false,
					canDownload: false,
					canCancel: false,
					canReload: true,
					message: 'failed',
					alert: true
				})
				expect(actor.getSnapshot().context.request).toBe(request)
				actor.send({ type: 'OBSERVE', facts })
				actor.send({ type: 'SUBMIT', submission: prepareBackupSubmission('none', '') })
				actor.send({ type: 'SHUTDOWN' })
				expect(actor.getSnapshot().status).toBe('active')
				expect(actor.getSnapshot().context.request).toBe(request)
				expect(rollbackAttempt).toHaveBeenCalledOnce()
			} finally {
				// Native test cleanup does not acknowledge success to the application owner.
				await rollback?.()
				actor.stop()
			}
		}
	)
})

function backupFacts(g: Awaited<ReturnType<typeof seed>>): BackupObservation {
	return {
		identityId,
		workspaceId: g.organization,
		membershipId: g.member,
		memberUserId: identityId,
		ownerId: identityId,
		role: 'owner',
		access: 'all',
		sessionReady: true,
		attached: true,
		loading: false,
		failed: false
	}
}

it('previews repeated backup submissions without consuming passwords or allocating SDK requests', async () => {
	const g = await seed()
	const facts = backupFacts(g)
	const logic = createWorkspaceBackupMachine({
		db,
		environment: 'test',
		observe: () => facts,
		handoff: { dispatch: async () => 'rejected' }
	})
	const submission = prepareBackupSubmission('password', 'private-preview-password')
	const random = vi.spyOn(crypto, 'randomUUID')
	try {
		const [initial] = initialTransition(logic, {})
		for (let attempt = 0; attempt < 2; attempt++) {
			const [preview] = transition(logic, initial, { type: 'SUBMIT', submission })
			expect(preview.matches({ preparing: 'working' })).toBe(true)
			expect(JSON.stringify(preview)).not.toContain('private-preview-password')
		}
		expect(random).not.toHaveBeenCalled()
		expect(takeBackupProtection(submission)).toEqual({
			kind: 'password',
			password: 'private-preview-password'
		})
		expect(() => takeBackupProtection(submission)).toThrow('Backup submission unavailable')
	} finally {
		submission.release()
	}
})

it.each([
	'cancel',
	'shutdown',
	'replace',
	'replace-then-cancel',
	'shutdown-then-replace',
	'release-rejected'
])('drains late backup request preparation through %s without exporting', async (intent) => {
	const g = await seed()
	let facts = backupFacts(g)
	const entered = Promise.withResolvers<void>()
	const acquired =
		Promise.withResolvers<
			import('delightful-local-first/backend/jazz/backup').JazzArchiveExportRequest
		>()
	const released = Promise.withResolvers<void>()
	const release = vi.fn(() => released.promise)
	const request: import('delightful-local-first/backend/jazz/backup').JazzArchiveExportRequest = {
		release,
		toJSON: () => ({ kind: 'jazzArchiveExport' })
	}
	const logic = createWorkspaceBackupMachine({
		db,
		environment: 'test',
		observe: () => facts,
		handoff: { dispatch: async () => 'rejected' }
	})
	const prepare = logic.sources.actors.prepare
	const actor = createActor(
		logic.provide({
			actors: {
				prepare: createAsyncLogic<
					import('delightful-local-first/backend/jazz/backup').JazzArchiveExportRequest,
					InputFrom<typeof prepare>
				>({
					run: ({ input }) => {
						takeBackupProtection(input.submission)
						entered.resolve()
						return acquired.promise
					}
				})
			}
		}),
		{ input: {} }
	).start()
	try {
		actor.send({
			type: 'SUBMIT',
			submission: prepareBackupSubmission('password', 'private-preparation-password')
		})
		await entered.promise
		expect(JSON.stringify(actor.getSnapshot())).not.toContain('private-preparation-password')
		if (intent === 'cancel' || intent === 'release-rejected') actor.send({ type: 'CANCEL' })
		if (intent.startsWith('shutdown')) actor.send({ type: 'SHUTDOWN' })
		if (intent.includes('replace')) {
			facts = { ...facts, workspaceId: crypto.randomUUID() }
			actor.send({ type: 'OBSERVE', facts })
		}
		if (intent === 'replace-then-cancel') actor.send({ type: 'CANCEL' })
		acquired.resolve(request)
		await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
		expect(actor.getSnapshot().status).toBe('active')
		if (intent === 'release-rejected') {
			released.reject(new Error('Request release unavailable'))
			await waitFor(actor, (snapshot) => selectWorkspaceBackup(snapshot).canReload, {
				timeout: 1000
			})
			expect(actor.getSnapshot().context.request).toBe(request)
			actor.send({ type: 'SHUTDOWN' })
			expect(actor.getSnapshot().status).toBe('active')
			return
		}
		released.resolve()
		await waitFor(
			actor,
			(snapshot) =>
				intent.startsWith('shutdown') ? snapshot.status === 'done' : snapshot.matches('editing'),
			{ timeout: 1000 }
		)
		expect(actor.getSnapshot().context.request).toBeUndefined()
		if (intent === 'cancel')
			expect(selectWorkspaceBackup(actor.getSnapshot()).message).toBe('cancelled')
		if (intent.startsWith('replace'))
			expect(selectWorkspaceBackup(actor.getSnapshot()).message).toBeUndefined()
	} finally {
		acquired.resolve(request)
		released.resolve()
		actor.stop()
	}
})
