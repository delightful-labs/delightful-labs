import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const filename = fileURLToPath(import.meta.url)
const versions = { alpha67: '2.0.0-alpha.67', beta1: '2.0.0-beta.1' }

function modules(directory) {
	const require = createRequire(join(directory, 'package.json'))
	const version = require('jazz-tools/package.json').version
	const native = createRequire(require.resolve('jazz-tools/package.json'))
	assert.equal(
		JSON.parse(readFileSync(join(dirname(native.resolve('jazz-napi')), 'package.json'))).version,
		version
	)
	return {
		version,
		load: (entry) => import(pathToFileURL(require.resolve(entry)).href),
		schema: () => import(pathToFileURL(join(directory, 'retained-schema.mjs')).href)
	}
}

async function runClient(directory) {
	const sdk = modules(directory)
	const { app } = await sdk.schema()
	const { createJazzClient } = await sdk.load('jazz-tools/client')
	let session
	let stored = null
	const db = () => {
		const snapshot = session?.getSnapshot()
		assert.equal(snapshot?.status, 'ready', 'Expected an admitted native session')
		assert.ok(snapshot.client)
		return snapshot.client.db
	}
	async function execute(message) {
		if (message.type === 'open') {
			stored = message.retainedStore ?? null
			session = await createJazzClient({
				...message.config,
				bearer: () => message.config.bearer ?? null,
				store: {
					read: async () => stored,
					update: async (transform) => {
						stored = transform(stored)
					}
				},
				driver: { type: 'memory' },
				client: () => sdk.load('jazz-tools/local-first'),
				localFirst: 'now',
				slowQueryThresholdMs: 0
			})
			const snapshot = session.getSnapshot()
			assert.equal(snapshot.status, 'ready')
			assert.equal(snapshot.localFirst, true)
			assert.ok(snapshot.user)
			return { version: sdk.version, accountId: snapshot.user.accountId, kind: snapshot.user.kind }
		}
		if (message.type === 'store') {
			assert.equal(typeof stored, 'string')
			return stored
		}
		if (message.type === 'read')
			return db().one(
				app.transactions
					.where({ id: message.id })
					.select('*', '$createdBy', '$createdAt', '$updatedBy', '$updatedAt'),
				{ tier: message.tier ?? 'remote' }
			)
		if (message.type === 'write') {
			await db()
				.update(app.transactions, message.id, message.values)
				.wait({ tier: message.tier ?? 'global', timeoutMs: 10_000 })
			return true
		}
		if (message.type === 'denied') {
			await assert.rejects(
				db()
					.update(app.transactions, message.id, { memo: 'forbidden mixed-version write' })
					.wait({ tier: 'global', timeoutMs: 10_000 }),
				/AuthorizationDenied|permission_denied/
			)
			return true
		}
		if (message.type === 'disconnect') {
			await db().disconnect()
			return true
		}
		if (message.type === 'reconnect') {
			await db().reconnect()
			return true
		}
		if (message.type === 'close') {
			await session?.close()
			stored = null
			return true
		}
		throw new Error('Unknown mixed-version fixture operation')
	}
	process.on('message', (message) => {
		void execute(message).then(
			(value) => process.send({ request: message.request, value }),
			(error) =>
				process.send({
					request: message.request,
					error: error instanceof Error ? error.message : 'Unexpected native fixture rejection'
				})
		)
	})
	process.on('disconnect', () => {
		void session?.close().finally(() => process.exit())
	})
}

function client(directory) {
	const child = fork(filename, ['--client', directory], {
		stdio: ['ignore', 'inherit', 'inherit', 'ipc']
	})
	const pending = new Map()
	let nextRequest = 0
	child.on('message', (message) => {
		const waiter = pending.get(message.request)
		if (!waiter) return
		clearTimeout(waiter.timer)
		pending.delete(message.request)
		if (message.error) waiter.reject(new Error(message.error))
		else waiter.resolve(message.value)
	})
	const rejectPending = (error) => {
		for (const waiter of pending.values()) {
			clearTimeout(waiter.timer)
			waiter.reject(error)
		}
		pending.clear()
	}
	child.on('exit', () => rejectPending(new Error('Mixed-version client exited before settlement')))
	child.on('error', rejectPending)
	return {
		request(message) {
			return new Promise((resolve, reject) => {
				const request = ++nextRequest
				const timer = setTimeout(() => {
					pending.delete(request)
					reject(new Error(`Mixed-version ${message.type} did not settle`))
				}, 30_000)
				pending.set(request, { resolve, reject, timer })
				child.send({ ...message, request }, (error) => {
					if (!error || !pending.has(request)) return
					clearTimeout(timer)
					pending.delete(request)
					reject(error)
				})
			})
		},
		async stop() {
			const exited = child.pid === undefined || child.exitCode !== null || child.signalCode !== null
			const closed = exited
				? Promise.resolve()
				: new Promise((resolve) => child.once('exit', resolve))
			try {
				if (child.connected) await this.request({ type: 'close' })
			} finally {
				if (child.connected) child.disconnect()
				if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
				await closed
			}
		}
	}
}

async function qualify(readers, kind) {
	const roots = Object.fromEntries(Object.keys(versions).map((name) => [name, join(readers, name)]))
	for (const name of Object.keys(versions)) {
		assert.equal(modules(roots[name]).version, versions[name])
		assert.equal(
			readFileSync(join(roots[name], 'jazz.app.json'), 'utf8'),
			readFileSync(join(dirname(filename), '../../src/lib/jazz.app.json'), 'utf8'),
			'Prepared reader must contain the current Finance schema'
		)
		assert.equal(
			readFileSync(join(roots[name], 'jazz.permissions.json'), 'utf8'),
			readFileSync(join(dirname(filename), '../../src/lib/jazz.permissions.json'), 'utf8')
		)
	}
	const sdk = modules(roots.beta1)
	const { app, permissions } = await sdk.schema()
	const { startTestJazz } = await sdk.load('jazz-tools/testing')
	const server = await startTestJazz({ app, permissions, slowQueryThresholdMs: 0 })
	const clients = [client(roots.alpha67), client(roots.beta1)]
	try {
		const identities = []
		let retainedStore = null
		for (const [index, name] of Object.keys(versions).entries()) {
			const userId = crypto.randomUUID()
			if (kind === 'backend') await server.as(userId)
			const identity = await clients[index].request({
				type: 'open',
				retainedStore: kind === 'retained-device' ? retainedStore : null,
				config: {
					scope: server.appId,
					serverUrl: server.url,
					...(kind === 'backend' ? { bearer: server.bearer(userId) } : { initial: 'device' })
				}
			})
			assert.equal(identity.version, versions[name])
			assert.equal(identity.kind, kind === 'backend' ? 'backend' : 'device')
			identities.push(identity.accountId)
			if (kind === 'retained-device' && index === 0)
				retainedStore = await clients[0].request({ type: 'store' })
		}
		retainedStore = null
		if (kind === 'retained-device') assert.equal(identities[0], identities[1])
		const db = server.jazz.db
		const organization = await db
			.insert(app.organizations, {
				name: 'Mixed-version qualification',
				kind: 'personal',
				defaultCurrency: 'USD',
				ownerId: identities[0]
			})
			.wait({ tier: 'global' })
		for (const userId of new Set(identities))
			await db
				.insert(app.organizationMembers, {
					organizationId: organization.id,
					userId,
					role: 'owner',
					accountAccessMode: 'all'
				})
				.wait({ tier: 'global' })
		const account = await db
			.insert(app.accounts, {
				organizationId: organization.id,
				name: 'Mixed-version ledger',
				kind: 'cash',
				currency: 'USD'
			})
			.wait({ tier: 'global' })
		const category = await db
			.insert(app.categories, {
				organizationId: organization.id,
				name: 'Mixed-version category',
				kind: 'expense',
				isSystem: false
			})
			.wait({ tier: 'global' })
		const transaction = await db
			.insert(app.transactions, {
				organizationId: organization.id,
				accountId: account.id,
				categoryId: category.id,
				amountMinor: 1234,
				currency: 'USD',
				kind: 'expense',
				bookedOn: '2026-11-24',
				source: 'manual'
			})
			.wait({ tier: 'global' })
		const read = (index, tier) => clients[index].request({ type: 'read', id: transaction.id, tier })
		for (const author of [0, 1]) {
			const values = { amountMinor: author === 0 ? 4213 : 9876, memo: `SDK ${author}` }
			await clients[author].request({ type: 'write', id: transaction.id, values })
			const rows = await Promise.all([read(0), read(1)])
			assert.deepEqual(rows[0], rows[1], 'Both SDKs must read identical fields and audit metadata')
			assert.equal(rows[0].amountMinor, values.amountMinor)
			assert.equal(rows[0].memo, values.memo)
		}
		await clients[0].request({ type: 'disconnect' })
		await clients[0].request({
			type: 'write',
			id: transaction.id,
			values: { amountMinor: 5555 },
			tier: 'local'
		})
		assert.equal((await read(0, 'local-first')).amountMinor, 5555)
		assert.equal((await read(1)).amountMinor, 9876)
		await clients[0].request({ type: 'reconnect' })
		await clients[0].request({ type: 'write', id: transaction.id, values: { memo: 'reconciled' } })
		assert.equal((await read(1)).amountMinor, 5555)
		await db
			.delete(
				app.organizationMembers,
				(
					await db.one(
						app.organizationMembers.where({
							organizationId: organization.id,
							userId: identities[0]
						})
					)
				).id
			)
			.wait({ tier: 'global' })
		await clients[0].request({ type: 'denied', id: transaction.id })
		if (kind === 'retained-device') await clients[1].request({ type: 'denied', id: transaction.id })
		else assert.equal((await read(1)).memo, 'reconciled')
		assert.equal((await db.one(app.transactions.where({ id: transaction.id }))).memo, 'reconciled')
	} finally {
		const closed = await Promise.allSettled(clients.map((resource) => resource.stop()))
		await server.stop()
		for (const result of closed) if (result.status === 'rejected') throw result.reason
	}
	console.log(
		JSON.stringify({
			versions,
			kind,
			retainedAccountStore: kind === 'retained-device',
			betaServer: true,
			simultaneousClients: true,
			bidirectionalWrites: true,
			exactAuditReadback: true,
			offlineReconciliation: true,
			revokedWriteRefused: true
		})
	)
}

if (process.argv[2] === '--client') await runClient(resolve(process.argv[3]))
else {
	assert.ok(process.argv[2], 'Pass a prepared Finance retained-reader directory')
	for (const kind of ['backend', 'device', 'retained-device'])
		await qualify(resolve(process.argv[2]), kind)
}
