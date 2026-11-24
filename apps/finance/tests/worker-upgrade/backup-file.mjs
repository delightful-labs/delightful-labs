import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Opt-in real-file rehearsal against an already prepared, disposable E2E server.
// No archive rows, amounts, names, keys or comparison digests are printed.
const [sourceArgument, originArgument, ...extra] = process.argv.slice(2)
assert.ok(
	sourceArgument && originArgument && !extra.length,
	'Pass a backup file and the localhost origin of a disposable Finance E2E server'
)
const target = new URL(originArgument)
assert.ok(
	target.protocol === 'http:' &&
		['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) &&
		!target.username &&
		!target.password &&
		target.pathname === '/' &&
		!target.search &&
		!target.hash,
	'The rehearsal requires a localhost-only HTTP origin'
)
const finance = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = resolve(sourceArgument)
const origin = target.origin
assert.ok(
	(await stat(sourcePath)).size <= 64 * 1024 * 1024,
	'Backup exceeds the released envelope limit'
)
const require = createRequire(join(finance, 'package.json'))
assert.equal(require('jazz-tools/package.json').version, '2.0.0-beta.1')
const sdk = createRequire(require.resolve('jazz-tools/package.json'))
const { build } = sdk('esbuild')
const { chromium, expect } = require('@playwright/test')
const work = await mkdtemp(join(tmpdir(), 'finance-backup-rehearsal-'))
const moduleDirectory = await mkdtemp(join(finance, '.svelte-kit/backup-rehearsal-'))
const modulePath = join(moduleDirectory, 'api.mjs')
let phase = 'prepare',
	context,
	checked,
	opening,
	planning
let succeeded = false
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex')
const original = await readFile(sourcePath)
const originalHash = fingerprint(original)
const foreignRequests = [],
	pageErrors = []

async function launch(offline = false) {
	context = await chromium.launchPersistentContext(join(work, 'profile'), {
		headless: true,
		channel: 'chromium',
		acceptDownloads: true,
		offline,
		serviceWorkers: 'allow'
	})
	await context.route('**/*', (route) => {
		const url = new URL(route.request().url())
		if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:')
			return route.continue()
		foreignRequests.push(url.origin)
		return route.abort()
	})
	context.on('page', (page) => page.on('pageerror', (error) => pageErrors.push(error.name)))
	const page = context.pages()[0] ?? (await context.newPage())
	page.on('pageerror', (error) => pageErrors.push(error.name))
	return page
}
async function fixture(page, operation, args = []) {
	await page.waitForFunction(() => Boolean(window.financeFixture))
	return page.evaluate(({ operation, args }) => window.financeFixture.request(operation, args), {
		operation,
		args
	})
}
async function install(page) {
	await expect.poll(() => fixture(page, 'helpers/workspace:38'), { timeout: 30000 }).toBe(true)
	await fixture(page, 'helpers/workspace:48')
}
async function navigateWorkspaces(page) {
	const toggle = page.getByRole('button', { name: 'Toggle Main navigation', exact: true })
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
	const details = page
		.locator('aside details')
		.filter({ has: page.locator('summary').filter({ hasText: 'Settings' }) })
	if ((await details.getAttribute('open')) === null) await details.locator('summary').click()
	const link = page.locator('aside').getByRole('link', { name: 'Workspaces', exact: true })
	await Promise.all([
		page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() }),
		link.click()
	])
	await expect(page.getByRole('textbox', { name: 'Workspace name', exact: true })).toBeVisible()
}
const sorted = (rows) => rows.toSorted((a, b) => String(a.id).localeCompare(String(b.id)))
function business(row, translate) {
	return Object.fromEntries(
		Object.entries(row)
			.filter(
				([key]) =>
					!key.startsWith('sourceCreated') &&
					!key.startsWith('sourceUpdated') &&
					!key.startsWith('$') &&
					!['restoreOperationId', '_restoreOperationId', 'originalBytes'].includes(key)
			)
			.map(([key, value]) => [key, translate(value)])
	)
}
try {
	await build({
		stdin: {
			contents: `export { prepareArchiveOpen } from 'delightful-local-first/backup/envelope'; export { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'; export { createActor, toPromise } from 'xstate'; export { prepareFinanceRestorePlan, financeRestorePlanningMachine } from './src/lib/machines/workspaces/workspace-restore-plan.ts'; export { validateFinanceBackup } from './src/lib/backup/workspace.ts';`,
			resolveDir: finance
		},
		bundle: true,
		packages: 'external',
		platform: 'node',
		format: 'esm',
		outfile: modulePath
	})
	const api = await import(pathToFileURL(modulePath))
	opening = api.prepareArchiveOpen(new Uint8Array(original))
	checked = await api.toPromise(
		api.createActor(api.createArchiveEnvelopeMachine(), { input: { request: opening } }).start()
	)
	assert.equal(checked.outcome, 'integrityChecked')
	const source = checked.archive.readPayload()
	assert.equal(api.validateFinanceBackup(source), true)
	const payloadBytes = checked.archive.copyPayloadBytes()
	const privateFile = join(work, 'backup.dlf')
	await copyFile(sourcePath, privateFile)
	phase = 'restore-screen'
	let page = await launch()
	await page.goto(origin)
	await expect(page.getByLabel('Current Workspace', { exact: true })).not.toHaveValue('')
	await navigateWorkspaces(page)
	await install(page)
	const restore = page.getByRole('region', { name: 'Restore Workspace', exact: true })
	await restore.getByLabel('Backup', { exact: true }).setInputFiles(privateFile)
	await restore.getByRole('button', { name: 'Restore Workspace', exact: true }).click()
	await restore.getByRole('button', { name: 'Create Workspace', exact: true }).click()
	await expect(restore.getByRole('status')).toHaveText('Done', { timeout: 90000 })
	phase = 'open-restored-workspace'
	await Promise.all([
		page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() }),
		restore.getByRole('button', { name: 'Open Workspace', exact: true }).click()
	])
	const workspaceId = new URL(page.url()).searchParams.get('workspace')
	assert.ok(workspaceId)
	await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
	const actual = await fixture(page, 'features/workspace-alpha59-restore.e2e:61', [workspaceId])
	phase = 'exact-record-comparison'
	assert.equal(actual.status, 'active')
	assert.ok(
		Buffer.from(actual.sourceBytes).equals(Buffer.from(payloadBytes)),
		'Original archive payload/history bytes differ'
	)
	planning = api.prepareFinanceRestorePlan(checked.archive, {
		applicationId: actual.applicationId,
		environment: actual.environment,
		identityId: actual.identityId,
		workspaceId: source.source.workspaceId,
		operationId: actual.operationId,
		generation: 0
	})
	const planned = await api.toPromise(
		api.createActor(api.financeRestorePlanningMachine, { input: { request: planning } }).start()
	)
	assert.equal(planned.outcome, 'planned')
	const reverse = new Map(
		planned.plan
			.read()
			.intent.plan.mappings.map((mapping) => [mapping.destinationId, mapping.sourceId])
	)
	const originalOwner = source.records.find((row) => row.type === 'organizations').fields.ownerId
		.value
	const translate = (value) =>
		value === actual.identityId
			? originalOwner
			: typeof value === 'string'
				? (reverse.get(value) ?? value)
				: value instanceof Date
					? value.toISOString()
					: value
	let recordsCompared = 0
	for (const [type, rows] of Object.entries(actual.rows)) {
		const expected = source.records
			.filter((row) => row.type === type)
			.map((row) =>
				business(
					{
						id: row.id,
						...Object.fromEntries(
							Object.entries(row.fields).map(([key, value]) => [
								key,
								value.kind === 'null'
									? null
									: value.kind === 'integer'
										? Number(value.value)
										: value.kind === 'reference' || value.kind === 'attachment'
											? value.id
											: value.value
							])
						)
					},
					(value) => value
				)
			)
		assert.ok(
			isDeepStrictEqual(sorted(rows.map((row) => business(row, translate))), sorted(expected)),
			'Restored business fields differ: ' + type
		)
		recordsCompared += expected.length
	}
	assert.equal(recordsCompared, source.records.length)
	assert.equal(actual.members.length, 1)
	assert.equal(actual.members[0].userId, actual.identityId)
	assert.equal(actual.members[0].role, 'owner')
	phase = 'full-browser-restart'
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready
	})
	const reopenUrl = page.url()
	await context.close()
	context = undefined
	page = await launch()
	await page.goto(reopenUrl)
	await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
	await install(page)
	const reopened = await fixture(page, 'features/workspace-alpha59-restore.e2e:61', [workspaceId])
	assert.equal(reopened.identityId, actual.identityId)
	assert.ok(isDeepStrictEqual(reopened.rows, actual.rows), 'Records changed after browser restart')
	assert.ok(
		Buffer.from(reopened.sourceBytes).equals(Buffer.from(payloadBytes)),
		'Archive history changed after browser restart'
	)
	phase = 'cold-offline-restart'
	const cdp = await context.newCDPSession(page)
	await cdp.send('Network.enable')
	await cdp.send('Network.clearBrowserCache')
	await cdp.detach()
	await context.close()
	context = undefined
	page = await launch(true)
	const offlineResponse = await page.goto(reopenUrl)
	assert.equal(offlineResponse?.fromServiceWorker(), true)
	assert.equal(await page.evaluate(() => navigator.onLine), false)
	await expect(page.getByLabel('Current Workspace', { exact: true })).toHaveValue(workspaceId)
	await install(page)
	const offline = await fixture(page, 'features/workspace-alpha59-restore.e2e:61', [
		workspaceId,
		'local-first'
	])
	assert.equal(offline.identityId, actual.identityId)
	assert.ok(
		isDeepStrictEqual(offline.rows, actual.rows),
		'Records changed after cold offline restart'
	)
	assert.ok(
		Buffer.from(offline.sourceBytes).equals(Buffer.from(payloadBytes)),
		'Archive history changed after cold offline restart'
	)
	assert.equal(pageErrors.length, 0, 'Page exception observed')
	assert.equal(foreignRequests.length, 0, 'Unexpected external request attempted')
	assert.ok(fingerprint(await readFile(sourcePath)) === originalHash, 'Original backup changed')
	succeeded = true
	console.log(
		JSON.stringify({
			archiveProfileVersion: source.profile.version,
			integrityChecked: true,
			financeGraphValid: true,
			recordsCompared,
			transactions: source.records.filter((row) => row.type === 'transactions').length,
			exactBusinessFieldsAndRelationships: true,
			exactSourcePayloadAndEmbeddedHistoryBytes: true,
			nativeRestoreThroughApplicationWorker: true,
			fullBrowserRestart: true,
			coldOfflineRestartWithHttpCacheCleared: true,
			restoredIdentitySurvivedRestart: true,
			originalBackupUnchanged: true,
			pageExceptions: 0,
			foreignRequests: 0
		})
	)
} catch (error) {
	await writeFile(join(work, 'failure.txt'), error instanceof Error ? error.stack : String(error), {
		mode: 0o600
	})
	console.error(JSON.stringify({ outcome: 'failed', phase, privateDiagnostics: work }))
	process.exitCode = 1
} finally {
	await context?.close()
	planning?.release()
	if (checked?.outcome === 'integrityChecked') checked.archive.release()
	opening?.release()
	original.fill(0)
	await rm(moduleDirectory, { recursive: true, force: true })
	if (succeeded) await rm(work, { recursive: true, force: true })
}
