import { readFile } from 'node:fs/promises'
import { createSilentJazzProxy } from '../../../tests/helpers/silent-jazz-proxy.js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, firefox, webkit } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'
import { startTestJazz, type TestJazz } from 'jazz-tools/testing'
import { createActor, toPromise } from 'xstate'
import { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
import { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'
import { app } from '../queries.js'
import permissions from '../jazz.permissions.json' with { type: 'json' }
import { workerRuntimeBuildConfig } from '../../../tooling/jazz-wasm.js'
import type {} from './restore-upgrade.browser.js'

let web: ViteDevServer, origin: string, file: number[], sourcePayload: Uint8Array
beforeAll(async () => {
	file = [...(await readFile(new URL('../../../retained-backup.dlf', import.meta.url)))]
	const request = prepareArchiveOpen(new Uint8Array(file))
	try {
		const result = await toPromise(
			createActor(createArchiveEnvelopeMachine(), { input: { request } }).start()
		)
		if (result.outcome !== 'integrityChecked') throw new Error('Retained fixture failed opening')
		try {
			sourcePayload = result.archive.copyPayloadBytes()
		} finally {
			result.archive.release()
		}
	} finally {
		request.release()
	}
	web = await createServer({
		...workerRuntimeBuildConfig(),
		configFile: false,
		logLevel: 'error',
		appType: 'custom',
		server: { host: '127.0.0.1', port: 0 },
		optimizeDeps: { entries: ['src/lib/backup/restore-upgrade.browser.ts'] }
	})
	web.middlewares.use((request, response, next) => {
		if (request.url !== '/') return next()
		response.setHeader('Content-Type', 'text/html')
		response.end(
			'<!doctype html><script type="module" src="/src/lib/backup/restore-upgrade.browser.ts"></script>'
		)
	})
	await web.listen()
	const address = web.httpServer?.address()
	if (!address || typeof address === 'string') throw new Error('Missing restore fixture listener')
	origin = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
	await web?.close()
})
const engines = [
	{ name: 'chromium', engine: chromium },
	{ name: 'firefox', engine: firefox },
	{ name: 'webkit', engine: webkit }
]

it.each(engines)(
	'$name restores a retained v1 file on the shared Db and recognizes its completed journal after reload',
	async ({ engine, name }) => {
		let authority: TestJazz | undefined
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		try {
			authority = await startTestJazz({ app, permissions, jazz: { allowedOrigins: [origin] } })
			const page = await browser.newPage()
			page.on('pageerror', (error) => console.error(error))
			await page.goto(origin)
			await page.waitForFunction(() => Boolean(window.financeRestoreUpgrade))
			const result = await page.evaluate(
				async ({ file, serverUrl }) => {
					const api = window.financeRestoreUpgrade
					const session = await api.open(serverUrl)
					window.financeRestoreUpgradeSession = session
					const selected = session.getSnapshot()
					if (!selected.user || !selected.client) throw new Error('Missing native restore identity')
					const db = selected.client.db
					let starts = 0
					const controller = api
						.createActor(
							api.createWorkspaceRestoreController(undefined, (options) => {
								starts++
								if (options.db !== db) throw new Error('Restore did not borrow the application Db')
								return api.createFinanceWorkspaceRestore(options)
							})
						)
						.start()
					const request = api.prepareWorkspaceRestoreFile(
						new File([new Uint8Array(file)], 'retained.dlf'),
						''
					)
					api.bindWorkspaceRestoreFile(request, session, {
						appId: 'delightful-finances',
						environment: 'upgrade-proof',
						serverUrl
					})
					controller.send({ type: 'SUBMIT', request })
					await api.waitFor(
						controller,
						(state) =>
							api.selectWorkspaceRestoreReport(state).view.canConfirm ||
							!api.selectWorkspaceRestoreReport(state).view.busy
					)
					const review = api.selectWorkspaceRestoreReport(controller.getSnapshot()).view
					if (!review.canConfirm)
						throw new Error('Restore did not reach review: ' + JSON.stringify(review))
					controller.send({ type: 'CONFIRM' })
					await api.waitFor(
						controller,
						(state) => !api.selectWorkspaceRestoreReport(state).view.busy
					)
					const view = api.selectWorkspaceRestoreReport(controller.getSnapshot()).view
					const usable =
						session.getSnapshot().client?.db === db &&
						(await db.all(api.app.organizations, { tier: 'remote' })).length === 1
					const frozen = Object.isFrozen(controller.getSnapshot().context)
					controller.stop()
					return { view, starts, usable, frozen, identityId: selected.user.accountId }
				},
				{ file, serverUrl: authority.url }
			)
			expect(result).toMatchObject({
				starts: 1,
				usable: true,
				frozen: true,
				view: { message: 'done', busy: false, canOpen: true }
			})
			const workspaceId = result.view.workspaceId
			if (!workspaceId) throw new Error('Missing restored workspace')
			const transactions = await authority.jazz.db.all(
				app.transactions.where({ organizationId: workspaceId })
			)
			expect(transactions).toMatchObject([
				{ amountMinor: Number.MAX_SAFE_INTEGER, bookedOn: '2026-11-17', source: 'manual' }
			])
			const files = await authority.jazz.db.all(
				app.files.where({ transactionId: { in: transactions.map((row) => row.id) } })
			)
			const attachment = files.find((item) => item.fileName === 'historical.bin')
			if (!attachment) throw new Error('Missing restored attachment')
			const parts = await authority.jazz.db.all(
				app.fileParts.where({ fileId: attachment.id }).orderBy('partIndex')
			)
			expect(new Uint8Array(parts.flatMap((part) => [...(part.data ?? [])]))).toEqual(
				new Uint8Array([0, 1, 127, 255])
			)
			const sources = await authority.jazz.db.all(app.files.where({ organizationId: workspaceId }))
			expect(sources).toHaveLength(1)
			const source = sources[0]
			if (!source) throw new Error('Missing retained source document')
			const sourceParts = await authority.jazz.db.all(
				app.fileParts.where({ fileId: source.id }).orderBy('partIndex')
			)
			expect(new Uint8Array(sourceParts.flatMap((part) => [...(part.data ?? [])]))).toEqual(
				sourcePayload
			)
			await page.evaluate(() => window.financeRestoreUpgradeSession.close())
			await page.reload()
			await page.waitForFunction(() => Boolean(window.financeRestoreUpgrade))
			const reopened = await page.evaluate(
				async ({ file, serverUrl }) => {
					const api = window.financeRestoreUpgrade,
						session = await api.open(serverUrl)
					window.financeRestoreUpgradeSession = session
					let starts = 0
					const controller = api
						.createActor(
							api.createWorkspaceRestoreController(undefined, (options) => {
								starts++
								return api.createFinanceWorkspaceRestore(options)
							})
						)
						.start()
					const request = api.prepareWorkspaceRestoreFile(
						new File([new Uint8Array(file)], 'retained.dlf'),
						''
					)
					api.bindWorkspaceRestoreFile(request, session, {
						appId: 'delightful-finances',
						environment: 'upgrade-proof',
						serverUrl
					})
					controller.send({ type: 'SUBMIT', request })
					await api.waitFor(
						controller,
						(state) => !api.selectWorkspaceRestoreReport(state).view.busy
					)
					const view = api.selectWorkspaceRestoreReport(controller.getSnapshot()).view
					const identityId = session.getSnapshot().user?.accountId
					controller.stop()
					await session.close()
					return { view, starts, identityId }
				},
				{ file, serverUrl: authority.url }
			)
			expect(reopened).toMatchObject({
				starts: 0,
				identityId: result.identityId,
				view: { message: 'done', busy: false, workspaceId }
			})
			expect(await authority.jazz.db.all(app.organizations)).toHaveLength(1)
			expect(
				await authority.jazz.db.all(app.transactions.where({ organizationId: workspaceId }))
			).toEqual(transactions)
		} finally {
			try {
				await browser.close()
			} finally {
				await authority?.stop()
			}
		}
	},
	60_000
)

const interruptions = engines.flatMap(({ name, engine }) =>
	['cancel', 'same-account', 'A-B-A'].map((mode) => ({ name, engine, mode }))
)
it.each(interruptions)(
	'$name rejects confirmation after $mode without writes or closing the application Db',
	async ({ engine, name, mode }) => {
		let authority: TestJazz | undefined
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		try {
			authority = await startTestJazz({ app, permissions, jazz: { allowedOrigins: [origin] } })
			const page = await browser.newPage()
			await page.goto(origin)
			await page.waitForFunction(() => Boolean(window.financeRestoreUpgrade))
			const result = await page.evaluate(
				async ({ file, serverUrl, mode }) => {
					const api = window.financeRestoreUpgrade,
						session = await api.open(serverUrl)
					try {
						const selected = session.getSnapshot()
						if (!selected.user || !selected.client)
							throw new Error('Missing native restore identity')
						let starts = 0
						const controller = api
							.createActor(
								api.createWorkspaceRestoreController(undefined, (options) => {
									starts++
									return api.createFinanceWorkspaceRestore(options)
								})
							)
							.start()
						const request = api.prepareWorkspaceRestoreFile(
							new File([new Uint8Array(file)], 'retained.dlf'),
							''
						)
						api.bindWorkspaceRestoreFile(request, session, {
							appId: 'delightful-finances',
							environment: 'upgrade-proof',
							serverUrl
						})
						controller.send({ type: 'SUBMIT', request })
						await api.waitFor(
							controller,
							(state) =>
								api.selectWorkspaceRestoreReport(state).view.canConfirm ||
								!api.selectWorkspaceRestoreReport(state).view.busy
						)
						const ready = api.selectWorkspaceRestoreReport(controller.getSnapshot()).view.canConfirm
						if (!ready) throw new Error('Restore did not reach review')
						if (mode === 'cancel') controller.send({ type: 'CANCEL' })
						else {
							const key = session.exportDeviceKey()
							if (mode === 'A-B-A') await session.createDeviceAccount()
							await session.restoreDeviceAccount(key)
						}
						await api.waitFor(
							controller,
							(state) => !api.selectWorkspaceRestoreReport(state).view.busy
						)
						controller.send({ type: 'CONFIRM' })
						const current = session.getSnapshot(),
							view = api.selectWorkspaceRestoreReport(controller.getSnapshot()).view
						if (!current.client) throw new Error('Application client was closed by restore')
						const usable =
							(await current.client.db.all(api.app.organizations, { tier: 'remote' })).length === 0
						controller.stop()
						return {
							starts,
							usable,
							view,
							sameIdentity: current.user?.accountId === selected.user.accountId,
							replacedClient: current.client !== selected.client
						}
					} finally {
						await session.close()
					}
				},
				{ file, serverUrl: authority.url, mode }
			)
			expect(result).toMatchObject({
				starts: 0,
				usable: true,
				sameIdentity: true,
				replacedClient: mode !== 'cancel',
				view: { busy: false, canConfirm: false, canOpen: false }
			})
			if (mode === 'cancel') expect(result.view.message).toBe('cancelled')
			expect(await authority.jazz.db.all(app.organizations)).toEqual([])
			expect(await authority.jazz.db.all(app.restoreOperations)).toEqual([])
			expect(await authority.jazz.db.all(app.transactions)).toEqual([])
		} finally {
			try {
				await browser.close()
			} finally {
				await authority?.stop()
			}
		}
	},
	60_000
)

async function startOwnedDrain(
	page: import('@playwright/test').Page,
	file: number[],
	serverUrl: string,
	scope: string,
	mode: 'new' | 'resume',
	fault: 'hold-commit' | 'artifacts' = 'hold-commit'
) {
	return page.evaluate(
		async ({ file, serverUrl, scope, mode, fault }) => {
			const api = window.financeRestoreUpgrade
			const session =
				mode === 'new' ? await api.open(serverUrl, scope) : window.financeRestoreUpgradeSession
			window.financeRestoreUpgradeSession = session
			const selected = session.getSnapshot(),
				db = selected.client?.db,
				user = selected.user
			if (!db || !user) throw new Error('Missing native drain identity')
			const isCurrent = () => {
				const current = session.getSnapshot()
				return current.status === 'ready' && current.user === user && current.client?.db === db
			}
			const previous = mode === 'resume' ? window.financeRestoreDrain.plan.intent : undefined
			const opening = api.prepareArchiveOpen(new Uint8Array(file))
			const checked = await api.toPromise(
				api.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opening } }).start()
			)
			if (checked.outcome !== 'integrityChecked') throw new Error('Missing retained drain archive')
			const sourceBinding = {
				applicationId: 'delightful-finances',
				environment: 'upgrade-proof',
				identityId: user.accountId,
				operationId: previous?.operation.operationId ?? crypto.randomUUID(),
				workspaceId: checked.archive.readPayload().source.workspaceId,
				generation: 1
			}
			const planning = api.prepareFinanceRestorePlan(checked.archive, sourceBinding, previous)
			const planned = await api.toPromise(
				api.createActor(api.financeRestorePlanningMachine, { input: { request: planning } }).start()
			)
			if (planned.outcome !== 'planned') throw new Error('Drain planning failed')
			const plan = planned.plan.read(),
				binding = { ...sourceBinding, workspaceId: plan.intent.operation.destinationWorkspaceId }
			const heldWrite =
				mode === 'new' && fault === 'hold-commit' ? plan.intent.plan.batches[0]?.writeId : undefined
			if (mode === 'new' && fault === 'hold-commit' && !heldWrite)
				throw new Error('Missing financial write to hold')
			const stats = { releases: 0, releaseAttempts: 0 }
			let commits: string[] = []
			const machine = api.createFinanceRestoreSession(
				{
					db,
					isCurrent,
					binding,
					intent: plan.intent,
					databaseName: 'finance-alpha66-accepted-drain',
					mode,
					releaseArtifacts() {
						stats.releaseAttempts++
						if (fault === 'artifacts' && stats.releaseAttempts === 1)
							throw new Error('Controlled artifact release failure')
						stats.releases++
						planning.release()
						checked.archive.release()
						opening.release()
					}
				},
				(db, retain) => {
					const probe = api.createRecoveryProbe(
						db,
						plan,
						checked.archive,
						heldWrite,
						retain,
						isCurrent
					)
					commits = probe.commits
					return probe
				}
			)
			const actor = api.createActor(machine)
			window.financeRestoreDrain = { actor, binding, plan, commits, stats }
			actor.start()
			return { workspaceId: binding.workspaceId, identityId: user.accountId }
		},
		{ file, serverUrl, scope, mode, fault }
	)
}

it.each(
	engines.flatMap(({ name, engine }) => [
		{ name, engine, interruption: 'cancel', resolution: 'resume' },
		{ name, engine, interruption: 'native replacement', resolution: 'resume' },
		{ name, engine, interruption: 'cancel', resolution: 'conflict' }
	])
)(
	'$name drains an accepted commit after $interruption and handles $resolution without replay',
	async ({ name, engine, interruption, resolution }) => {
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		let authority: TestJazz | undefined, proxy: ReturnType<typeof createSilentJazzProxy> | undefined
		try {
			authority = await startTestJazz({ app, permissions, jazz: { allowedOrigins: [origin] } })
			const transport = createSilentJazzProxy(authority.url)
			proxy = transport
			await transport.listen(0)
			const page = await browser.newPage()
			await page.exposeFunction('pauseRecoveryReplies', () => transport.pauseServerReplies())
			await page.goto(origin)
			await page.waitForFunction(() => Boolean(window.financeRestoreUpgrade))
			const admitted = await startOwnedDrain(page, file, transport.url, authority.appId, 'new')
			const database = authority.jazz.db
			await expect
				.poll(
					async () =>
						(await database.all(app.transactions.where({ organizationId: admitted.workspaceId })))
							.length
				)
				.toBe(1)
			const accepted = await database.all(
				app.transactions.where({ organizationId: admitted.workspaceId })
			)
			const pending = await page.evaluate(async (interruption) => {
				const api = window.financeRestoreUpgrade,
					runtime = window.financeRestoreDrain
				if (interruption === 'cancel') runtime.actor.send({ type: 'CANCEL' })
				else {
					const session = window.financeRestoreUpgradeSession,
						selected = session.getSnapshot()
					const key = session.exportDeviceKey()
					const stop = session.subscribe(() => {
						const now = session.getSnapshot()
						if (
							now.status !== 'ready' ||
							now.user !== selected.user ||
							now.client !== selected.client
						)
							runtime.actor.send({ type: 'INVALIDATE', binding: runtime.binding })
					})
					const replacement = session.createDeviceAccount()
					void replacement.catch(() => {})
					runtime.finishReplacement = async () => {
						await replacement
						stop()
						await session.restoreDeviceAccount(key)
					}
				}
				await api.waitFor(
					runtime.actor,
					(state) => state.matches('waitingForPending') || state.matches('settlingCommit')
				)
				return {
					status: runtime.actor.getSnapshot().status,
					releases: runtime.stats.releases,
					commits: runtime.commits.length,
					frozen: Object.isFrozen(runtime.actor.getSnapshot().context)
				}
			}, interruption)
			expect(pending).toEqual({ status: 'active', releases: 0, commits: 2, frozen: true })
			expect(
				await database.all(app.organizationMembers.where({ organizationId: admitted.workspaceId }))
			).toEqual([])
			transport.resume()
			const settled = await page.evaluate(async () => {
				const api = window.financeRestoreUpgrade,
					runtime = window.financeRestoreDrain
				const result = await api.toPromise(runtime.actor)
				const stats = { releases: runtime.stats.releases, commits: runtime.commits.length }
				await runtime.finishReplacement?.()
				return { result, ...stats }
			})
			expect(settled).toMatchObject({
				releases: 1,
				commits: 2,
				result: { outcome: interruption === 'cancel' ? 'cancelled' : 'invalidated' }
			})
			if (resolution === 'conflict') {
				const transaction = accepted[0]
				if (!transaction) throw new Error('Missing accepted row to change')
				await database
					.update(app.transactions, transaction.id, { amountMinor: Number.MAX_SAFE_INTEGER - 1 })
					.wait({ tier: 'global' })
			}
			const beforeResume = await database.all(
				app.transactions.where({ organizationId: admitted.workspaceId })
			)
			const resumed = await startOwnedDrain(page, file, transport.url, authority.appId, 'resume')
			expect(resumed).toEqual(admitted)
			const completed = await page.evaluate(async () => {
				const api = window.financeRestoreUpgrade,
					runtime = window.financeRestoreDrain
				const result = await api.toPromise(runtime.actor)
				const stats = { releases: runtime.stats.releases, commits: runtime.commits.length }
				const journal = await api.toPromise(
					api
						.createActor(api.createRestoreJournalStepMachine(), {
							input: {
								databaseName: 'finance-alpha66-accepted-drain',
								binding: runtime.binding,
								command: { mode: 'load', intent: runtime.plan.intent }
							}
						})
						.start()
				)
				await window.financeRestoreUpgradeSession.close()
				return { result, journal, ...stats }
			})
			expect(completed).toMatchObject({
				releases: 1,
				commits: resolution === 'conflict' ? 0 : 1,
				result: { outcome: resolution === 'conflict' ? 'conflict' : 'complete' },
				journal: { outcome: 'loaded' }
			})
			if (resolution === 'conflict') {
				expect(completed.result.record).toEqual(settled.result.record)
				expect(completed.journal.record).toEqual(settled.result.record)
			} else expect(completed.journal.record?.checkpoint.kind).toBe('complete')
			expect(
				await database.all(app.transactions.where({ organizationId: admitted.workspaceId }))
			).toEqual(beforeResume)
			expect(await database.all(app.organizations)).toHaveLength(1)
			expect(
				await database.all(app.organizationMembers.where({ organizationId: admitted.workspaceId }))
			).toMatchObject(
				resolution === 'conflict' ? [] : [{ userId: admitted.identityId, role: 'owner' }]
			)
		} finally {
			proxy?.resume()
			try {
				await browser.close()
			} finally {
				try {
					await proxy?.close()
				} finally {
					await authority?.stop()
				}
			}
		}
	},
	60_000
)

it.each(engines)(
	'$name retains artifacts after failed cleanup and releases them once on retry',
	async ({ name, engine }) => {
		const browser = await engine.launch({
			headless: true,
			...(name === 'chromium' ? { channel: 'chromium' } : {})
		})
		let authority: TestJazz | undefined
		try {
			authority = await startTestJazz({ app, permissions, jazz: { allowedOrigins: [origin] } })
			const page = await browser.newPage()
			await page.goto(origin)
			await page.waitForFunction(() => Boolean(window.financeRestoreUpgrade))
			const admitted = await startOwnedDrain(
				page,
				file,
				authority.url,
				authority.appId,
				'new',
				'artifacts'
			)
			const blocked = await page.evaluate(async () => {
				const api = window.financeRestoreUpgrade,
					runtime = window.financeRestoreDrain
				await api.waitFor(runtime.actor, (state) => state.matches('artifactsBlocked'))
				runtime.actor.send({ type: 'CANCEL' })
				return {
					status: runtime.actor.getSnapshot().status,
					...runtime.stats,
					commits: runtime.commits.length
				}
			})
			expect(blocked).toEqual({ status: 'active', releases: 0, releaseAttempts: 1, commits: 3 })
			const accepted = await authority.jazz.db.all(
				app.transactions.where({ organizationId: admitted.workspaceId })
			)
			expect(accepted).toMatchObject([{ amountMinor: Number.MAX_SAFE_INTEGER }])
			const done = await page.evaluate(async () => {
				const api = window.financeRestoreUpgrade,
					runtime = window.financeRestoreDrain
				runtime.actor.send({ type: 'RETRY_RELEASE' })
				const result = await api.toPromise(runtime.actor)
				const current = window.financeRestoreUpgradeSession.getSnapshot()
				if (!current.client) throw new Error('Cleanup closed the application Db')
				const usable =
					(await current.client.db.all(api.app.organizations, { tier: 'remote' })).length === 1
				await window.financeRestoreUpgradeSession.close()
				return { result, usable, ...runtime.stats, commits: runtime.commits.length }
			})
			expect(done).toMatchObject({
				releases: 1,
				releaseAttempts: 2,
				commits: 3,
				usable: true,
				result: { outcome: 'cancelled' }
			})
			expect(
				await authority.jazz.db.all(
					app.transactions.where({ organizationId: admitted.workspaceId })
				)
			).toEqual(accepted)
			expect(await authority.jazz.db.all(app.organizations)).toHaveLength(1)
		} finally {
			try {
				await browser.close()
			} finally {
				await authority?.stop()
			}
		}
	},
	60_000
)
