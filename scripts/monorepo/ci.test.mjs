import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { changedPaths, planForEvent, projects, selectChecks, validPrTitle } from './ci.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const selected = (paths) => Object.entries(selectChecks(paths)).filter(([, value]) => value).map(([name]) => name)

test('CI selects transitive consumers and unions changed application scopes', () => {
	assert.deepEqual(selected(['apps/website/src/+page.svelte']), ['website'])
	assert.deepEqual(selected(['apps/finance/src/app.ts']), ['finance'])
	for (const app of ['web', 'extension']) assert.deepEqual(selected([`apps/clipper/apps/${app}/src/app.ts`]), ['clipper'])
	assert.deepEqual(selected(['packages/local-first/src/index.ts']), ['local_first', 'finance', 'clipper'])
	assert.deepEqual(selected(['apps/website/a', 'apps/finance/b']), ['website', 'finance'])
	for (const path of ['packages/ui/src/button.svelte', 'pnpm-lock.yaml', 'AGENTS.md', '.github/workflows/ci.yml', 'new-project/a', 'apps/finance/../website/a', 'apps/finance/a\\b']) assert.deepEqual(selected([path]), projects)
	assert.deepEqual(selected([]), [])
})

test('manual, new branch, invalid or missing comparison history runs every project', () => {
	for (const [name, event] of [['workflow_dispatch', {}], ['pull_request', {}], ['push', { before: '0'.repeat(40), after: 'a'.repeat(40) }], ['push', { before: '--help', after: 'a'.repeat(40) }], ['push', { before: 'a'.repeat(40), after: 'b'.repeat(40) }]]) {
		assert.deepEqual(Object.values(planForEvent(name, event, root).checks), projects.map(() => true))
	}
})

test('real Git renames, deletions, newline names and divergent pushes preserve affected scopes', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-ci-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const git = (...args) => execFileSync('git', ['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
	const put = (path, text) => { mkdirSync(dirname(resolve(cwd, path)), { recursive: true }); writeFileSync(resolve(cwd, path), text) }
	const commit = (message) => { git('add', '-A'); git('commit', '-m', message); return git('rev-parse', 'HEAD') }
	git('init', '--quiet')
	put('apps/website/old\nname.txt', 'original')
	const base = commit('base')
	put('apps/finance/placeholder', 'finance')
	renameSync(resolve(cwd, 'apps/website/old\nname.txt'), resolve(cwd, 'apps/finance/moved.txt'))
	const head = commit('rename')
	assert.deepEqual(changedPaths(base, head, cwd).sort(), ['apps/finance/moved.txt', 'apps/finance/placeholder', 'apps/website/old\nname.txt'].sort())
	assert.deepEqual(Object.entries(planForEvent('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }, cwd).checks).filter(([, value]) => value).map(([name]) => name), ['website', 'finance'])
	git('checkout', '--detach', base)
	put('apps/clipper/new.txt', 'clipper')
	const divergent = commit('divergent push')
	const push = planForEvent('push', { before: head, after: divergent }, cwd)
	assert.deepEqual(Object.entries(push.checks).filter(([, value]) => value).map(([name]) => name), ['website', 'finance', 'clipper'])
	assert.throws(() => changedPaths('--help', head, cwd))
	assert.throws(() => changedPaths(base, head, cwd, '--bad-option'))
})

test('Conventional Commits titles cover every scope and reject malformed or multiline titles', () => {
	for (const title of ['feat: add a button', 'fix(finance): save transactions', 'refactor(ui)!: revise API', 'chore!: change workspace', 'docs: $(touch /tmp/never-run) `false`']) assert.equal(validPrTitle(title), true, title)
	for (const title of [undefined, null, '', 'Update finance', 'feat:', 'feat: ', 'Feat: title', 'fix(): title', 'fix: first\nsecond', 'fix: first\rsecond', 'fix:  extra-leading-space']) assert.equal(validPrTitle(title), false, String(title))
})

test('title CLI treats shell-looking text as JSON data and reports invalid titles', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-title-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const eventPath = resolve(cwd, 'event.json'), marker = resolve(cwd, 'should-not-exist')
	const cli = resolve(root, 'scripts/monorepo/ci.mjs')
	const run = (title) => {
		writeFileSync(eventPath, JSON.stringify({ pull_request: { title } }))
		return spawnSync(process.execPath, [cli, '--title'], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: eventPath } })
	}
	assert.equal(run(`docs: $(touch ${marker})`).status, 0)
	assert.throws(() => readFileSync(marker))
	const invalid = run('invalid title')
	assert.equal(invalid.status, 1)
	assert.match(invalid.stderr, /Conventional Commits/u)
})

test('all existing check jobs retain fail-closed routing; title workflow has no project or draft filter', () => {
	for (const name of ['ci', 'finance', 'clipper']) {
		const source = readFileSync(resolve(root, `.github/workflows/${name}.yml`), 'utf8')
		assert.doesNotMatch(source, /^\s+paths(?:-ignore)?:/mu)
		assert.match(source, /fetch-depth: 0/u)
		assert.match(source, /id: selection\n\s+run: node scripts\/monorepo\/ci.mjs\n\s+working-directory: \./u)
		const jobs = [...source.split('jobs:\n')[1].matchAll(/^  ([\w-]+):\n([\s\S]*?)(?=^  [\w-]+:\n|$(?![\s\S]))/gmu)]
		assert.ok(jobs.length > 1)
		for (const [, job, body] of jobs) {
			if (job === 'plan') continue
			assert.match(body, /needs: (?:plan|\[plan, web-browser, extension\])/u)
			assert.match(body, /always\(\) && \(needs.plan.result != 'success' \|\| needs.plan.outputs.\w+ == 'true'\)/u)
			assert.match(body, /steps:\n      - name: Require successful check selection\n        if: \$\{\{ needs.plan.result != 'success' \}\}\n        run: exit 1/u)
		}
	}
	const title = readFileSync(resolve(root, '.github/workflows/pr-title.yml'), 'utf8')
	assert.match(title, /pull_request:\n\s+types: \[opened, edited, synchronize, reopened, ready_for_review\]/u)
	assert.match(title, /node scripts\/monorepo\/ci.mjs --title/u)
	assert.doesNotMatch(title, /(?:paths:|paths-ignore:|draft|pull_request_target|\$\{\{.*title)/u)
})


test('the existing Clipper browser check requires both independent browser jobs', () => {
	const source = readFileSync(resolve(root, '.github/workflows/clipper.yml'), 'utf8')
	const job = (name) => source.split(`  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/u)[0] ?? ''
	const web = job('web-browser'), extension = job('extension'), required = job('browser')
	for (const command of ['test:e2e', 'test:schema', 'test:worker', 'test:offline', 'test:fake-data']) assert.ok(web.includes(`run: pnpm ${command}`))
	assert.doesNotMatch(web, /run: pnpm test:extension/u)
	assert.match(extension, /run: pnpm test:extension/u)
	assert.match(required, /needs: \[plan, web-browser, extension\]/u)
	assert.match(required, /name: Account, library and offline browser tests/u)
	assert.match(required, /WEB_RESULT: \$\{\{ needs.web-browser.result \}\}/u)
	assert.match(required, /EXTENSION_RESULT: \$\{\{ needs.extension.result \}\}/u)
	assert.ok(required.includes('test "$WEB_RESULT" = success'))
	assert.ok(required.includes('test "$EXTENSION_RESULT" = success'))
})
