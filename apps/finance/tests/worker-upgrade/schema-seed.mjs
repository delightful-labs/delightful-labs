import { createRequire } from 'node:module'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createJazz, sqlite } from 'jazz-tools/backend'

const require = createRequire(import.meta.url)
const sdk = createRequire(require.resolve('jazz-tools/package.json'))
const { build } = sdk('esbuild')
await build({
	entryPoints: ['src/lib/schema.ts'],
	outfile: 'retained-schema.mjs',
	bundle: true,
	packages: 'external',
	platform: 'node',
	format: 'esm'
})
await build({
	entryPoints: ['src/lib/permissions.ts'],
	outfile: 'retained-permissions.mjs',
	bundle: true,
	packages: 'external',
	platform: 'node',
	format: 'esm'
})
const { app } = await import('./retained-schema.mjs')
const { default: permissions } = await import('./retained-permissions.mjs')
const { validateProject } = await import(
	pathToFileURL(join(dirname(sdk.resolve('./package.json')), 'dist/dev/catalogue-project.js'))
)
const { schema } = await validateProject({ schemaDir: process.cwd() })
const target = process.argv[2]
if (!target) throw new Error('Retained fixture output directory required')
const directory = await mkdtemp(join(target, 'retained-alpha60-'))
const jazz = createJazz({
	app,
	permissions,
	store: sqlite({ path: directory }),
	authenticate: async () => null
})
const ids = Object.fromEntries(
	['organization', 'owner', 'account', 'category', 'transaction', 'transfer', 'check'].map(
		(name) => [name, crypto.randomUUID()]
	)
)
try {
	await jazz.ready()
	const db = jazz.db
	await db
		.insert(
			app.organizations,
			{ name: 'Retained finance', kind: 'personal', defaultCurrency: 'USD', ownerId: ids.owner },
			{ id: ids.organization }
		)
		.wait({ tier: 'global' })
	await db
		.insert(
			app.accounts,
			{
				organizationId: ids.organization,
				name: '  Retained account  ',
				kind: 'cash',
				currency: 'USD'
			},
			{ id: ids.account }
		)
		.wait({ tier: 'global' })
	await db
		.insert(
			app.categories,
			{
				organizationId: ids.organization,
				name: 'Retained category',
				kind: 'expense',
				isSystem: false
			},
			{ id: ids.category }
		)
		.wait({ tier: 'global' })
	await db
		.insert(
			app.checks,
			{
				organizationId: ids.organization,
				accountId: ids.account,
				checkNumber: '  retained-check  ',
				checkDate: '2026-11-16'
			},
			{ id: ids.check }
		)
		.wait({ tier: 'global' })
	await db
		.insert(
			app.transactions,
			{
				organizationId: ids.organization,
				accountId: ids.account,
				categoryId: ids.category,
				amountMinor: Number.MAX_SAFE_INTEGER,
				kind: 'expense',
				currency: 'USD',
				bookedOn: '2026-11-16',
				source: 'simplefin',
				externalId: '  retained-provider-id  '
			},
			{ id: ids.transaction }
		)
		.wait({ tier: 'global' })
	await db
		.insert(
			app.internalTransfers,
			{
				organizationId: ids.organization,
				expenseTransactionId: ids.transaction,
				incomeTransactionId: ids.transaction,
				amountMinor: 0,
				currency: 'USD'
			},
			{ id: ids.transfer }
		)
		.wait({ tier: 'global' })
	const rows = {
		account: await db.one(app.accounts.where({ id: ids.account })),
		transaction: await db.one(app.transactions.where({ id: ids.transaction })),
		transfer: await db.one(app.internalTransfers.where({ id: ids.transfer })),
		check: await db.one(app.checks.where({ id: ids.check }))
	}
	await writeFile(
		join(target, 'retained-baseline.json'),
		JSON.stringify(
			{
				sdk: sdk('./package.json').version,
				schemaHash: schema.hash,
				appId: jazz.appId,
				directory,
				ids,
				rows
			},
			null,
			2
		) + '\n'
	)
	console.log('Seeded actual alpha.60 Finance records; closing before the candidate opens them')
} finally {
	await jazz.close()
}
