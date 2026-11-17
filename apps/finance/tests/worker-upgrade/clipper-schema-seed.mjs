import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createJazz, sqlite } from 'jazz-tools/backend'

const require = createRequire(import.meta.url)
const sdk = createRequire(require.resolve('jazz-tools/package.json'))
const { build } = sdk('esbuild')
const schemaDir = join(process.cwd(), 'src/lib/backend/jazz')
for (const [source, output] of [
	['schema', 'retained-schema'],
	['permissions', 'retained-permissions']
])
	await build({
		entryPoints: [join(schemaDir, `${source}.ts`)],
		outfile: `${output}.mjs`,
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
const { schema } = await validateProject({ schemaDir })
const target = process.argv[2]
if (!target) throw new Error('Retained fixture output directory required')
const directory = await mkdtemp(join(target, 'retained-alpha60-'))
const jazz = createJazz({
	app,
	permissions,
	store: sqlite({ path: directory }),
	authenticate: async () => null
})
const libraryId = crypto.randomUUID(),
	documentId = crypto.randomUUID()
const earlier = {
	version: 1,
	offset: 80,
	quote: 'Reading',
	prefix: '',
	suffix: '',
	interactedAt: new Date('2026-11-12T12:00:00Z')
}
const later = { ...earlier, offset: 20, interactedAt: new Date('2026-11-12T12:01:00Z') }
try {
	await jazz.ready()
	await jazz.db
		.insert(app.libraries, { ownerId: libraryId, bootstrapVersion: '1' }, { id: libraryId })
		.wait({ tier: 'global' })
	await jazz.db
		.insert(
			app.libraryDocuments,
			{
				libraryId,
				sourceUrl: 'https://example.com/retained-reading',
				readingProgress: 0.8,
				resumePosition: earlier,
				status: 'inbox',
				favorite: false,
				attachmentId: null
			},
			{ id: documentId }
		)
		.wait({ tier: 'global' })
	await jazz.db
		.update(app.libraryDocuments, documentId, { readingProgress: 0.2, resumePosition: later })
		.wait({ tier: 'global' })
	await writeFile(
		join(target, 'retained-baseline.json'),
		JSON.stringify(
			{
				sdk: sdk('./package.json').version,
				schemaHash: schema.hash,
				appId: jazz.appId,
				directory,
				libraryId,
				documentId,
				earlier,
				later
			},
			null,
			2
		) + '\n'
	)
} finally {
	await jazz.close()
}
