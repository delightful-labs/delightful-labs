import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { z } from 'zod'

const scenarioSchema = z.object({
	file: z.string(),
	title: z.string(),
	tags: z.array(z.string()),
	tests: z.array(z.object({ projectName: z.string() }))
})
type Scenario = z.output<typeof scenarioSchema>
type Suite = { title: string; specs: Scenario[]; suites: Suite[] }
const suiteSchema: z.ZodType<Suite> = z.object({
	title: z.string(),
	specs: z.array(scenarioSchema).default([]),
	suites: z.array(z.lazy(() => suiteSchema)).default([])
})
const reportSchema = z.object({ suites: z.array(suiteSchema) })

function discover(config: string): Scenario[] {
	const output = execFileSync(
		process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
		['exec', 'playwright', 'test', '--config', config, '--list', '--reporter=json'],
		{
			encoding: 'utf8',
			maxBuffer: 20 * 1024 * 1024,
			env: {
				...process.env,
				PLAYWRIGHT_JSON_OUTPUT_NAME: '',
				PLAYWRIGHT_JSON_OUTPUT_FILE: '',
				PLAYWRIGHT_JSON_OUTPUT_DIR: ''
			}
		}
	)
	const raw: unknown = JSON.parse(output)
	const report = reportSchema.parse(raw)
	const flatten = (suite: Suite, parents: string[] = []): Scenario[] => {
		const titles = [...parents, suite.title]
		return [
			...suite.specs.map((scenario) => ({
				...scenario,
				title: [...titles, scenario.title].join(' › ')
			})),
			...suite.suites.flatMap((child) => flatten(child, titles))
		]
	}
	return report.suites.flatMap((suite) => flatten(suite))
}

function key(scenario: Scenario) {
	return `${scenario.file}:${scenario.title}`
}

const canonical = discover('playwright.config.ts')
if (canonical.length === 0) throw new Error('Development discovery selected no scenarios')
if (
	canonical.some((scenario) => scenario.tests.length !== 1) ||
	new Set(canonical.map(key)).size !== canonical.length
)
	throw new Error('Development projects select duplicate scenarios')
console.log(`Development projects: ${canonical.length} unique scenarios`)

const isolatedSuites = {
	'pwa.e2e.ts': 'pwa',
	'pwa-cold-start.e2e.ts': 'pwa',
	'startup-stalled-remote.e2e.ts': 'startup',
	'debugging.e2e.ts': 'debug',
	'fake-data.e2e.ts': 'fake-data'
}
const isolatedFiles = new Set(Object.keys(isolatedSuites))
const developmentFiles = new Set(canonical.map((scenario) => scenario.file))
const files = readdirSync('tests', { recursive: true, encoding: 'utf8' })
	.filter((file) => file.endsWith('.e2e.ts'))
	.map((file) => file.replaceAll('\\', '/'))
for (const file of files) {
	if (isolatedFiles.has(file) && developmentFiles.has(file))
		throw new Error(`${file}: isolated runtime scenario included in development projects`)
	if (!isolatedFiles.has(file) && !developmentFiles.has(file))
		throw new Error(`${file}: no runtime owns this test file`)
}
for (const [file, runtime] of Object.entries(isolatedSuites)) {
	if (!files.includes(file) || !existsSync(`tests/config/playwright.${runtime}.config.ts`))
		throw new Error(`${file}: missing isolated runtime file or configuration`)
}
console.log(`${files.length} files assigned to development or isolated runtimes`)

const selections = {
	'transaction-attachments': 'attachments',
	'transaction-description': 'description',
	'transaction-edit': 'transaction-edit',
	'transaction-workspace': 'transactions',
	'transaction-cleanup': ['transactions', 'bank-sync', 'categories', 'tags'],
	permissions: 'permissions',
	auth: 'identity',
	workspace: 'workspaces',
	'account-archive': 'account-archive',
	'workflow-completion': 'workflow-completion',
	'workspace-rename': 'workspace-rename',
	accounts: 'accounts',
	categories: 'categories',
	tags: 'tags',
	navigation: 'navigation'
}
for (const [name, selection] of Object.entries(selections)) {
	const tags = typeof selection === 'string' ? [selection] : selection
	const focused = discover(`tests/config/playwright.${name}.config.ts`)
	const expected = canonical.filter((scenario) => tags.some((tag) => scenario.tags.includes(tag)))
	const actualKeys = focused.map(key).sort()
	const expectedKeys = expected.map(key).sort()
	if (focused.some((scenario) => scenario.tests.length !== 1))
		throw new Error(`${name}: focused projects select duplicate scenarios`)
	if (focused.length === 0 || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
		const actualSet = new Set(actualKeys)
		const expectedSet = new Set(expectedKeys)
		const missing = expectedKeys.filter((item) => !actualSet.has(item))
		const extra = actualKeys.filter((item) => !expectedSet.has(item))
		throw new Error(
			`${name}: focused scope differs from development coverage. Missing: ${missing.join(', ')}; extra: ${extra.join(', ')}`
		)
	}
	console.log(
		`${name}: ${focused.length} scenarios match canonical ${tags.map((tag) => `@${tag}`).join(' or ')} coverage`
	)
}
