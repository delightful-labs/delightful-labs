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
	for (const path of ['packages/ui/src/button.svelte', 'pnpm-lock.yaml', '.github/workflows/ci.yml', 'new-project/a', 'apps/finance/../website/a', 'apps/finance/a\\b']) assert.deepEqual(selected([path]), projects)
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
			assert.match(body, /needs: (?:plan|\[plan, web-browser, worker-offline, extension\])/u)
			assert.match(body, /always\(\) && \(needs.plan.result != 'success' \|\| needs.plan.outputs.\w+ == 'true'\)/u)
			assert.match(body, /steps:\n      - name: Require successful check selection\n        if: \$\{\{ needs.plan.result != 'success' \}\}\n        run: exit 1/u)
		}
	}
	const title = readFileSync(resolve(root, '.github/workflows/pr-title.yml'), 'utf8')
	assert.match(title, /pull_request:\n\s+types: \[opened, edited, synchronize, reopened, ready_for_review\]/u)
	assert.match(title, /node scripts\/monorepo\/ci.mjs --title/u)
	assert.doesNotMatch(title, /(?:paths:|paths-ignore:|draft|pull_request_target|\$\{\{.*title)/u)
})


test('the existing Clipper browser check requires all three independent browser jobs', () => {
	const source = readFileSync(resolve(root, '.github/workflows/clipper.yml'), 'utf8')
	const job = (name) => source.split(`  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/u)[0] ?? ''
	const web = job('web-browser'), worker = job('worker-offline'), extension = job('extension'), required = job('browser')
	assert.ok(web.includes('run: pnpm test:e2e'))
	for (const command of ['test:worker', 'test:offline', 'test:fake-data']) {
		assert.ok(worker.includes(`run: pnpm ${command}`))
		assert.ok(!web.includes(`run: pnpm ${command}`))
	}
	assert.doesNotMatch(web, /run: pnpm test:extension/u)
	assert.match(extension, /run: pnpm test:extension/u)
	assert.match(required, /needs: \[plan, web-browser, worker-offline, extension\]/u)
	assert.match(required, /name: Account, library and offline browser tests/u)
	assert.match(required, /WEB_RESULT: \$\{\{ needs.web-browser.result \}\}/u)
	assert.match(required, /EXTENSION_RESULT: \$\{\{ needs.extension.result \}\}/u)
	assert.ok(required.includes('test "$WEB_RESULT" = success'))
	assert.match(required, /WORKER_RESULT: \$\{\{ needs.worker-offline.result \}\}/u)
	assert.ok(required.includes('test "$WORKER_RESULT" = success'))
	assert.ok(required.includes('test "$EXTENSION_RESULT" = success'))
})


test('Markdown-only changes skip suites; mixed, forced and suspicious paths retain conservative routing', () => {
	assert.deepEqual(selected(['AGENTS.md', 'apps/finance/README.md', 'packages/ui/Guide.MD']), [])
	assert.deepEqual(selected(['apps/finance/README.md', 'apps/finance/src/app.ts']), ['finance'])
	assert.deepEqual(selected(['README.md', 'apps/finance/src/app.ts']), projects)
	assert.deepEqual(Object.values(selectChecks(['README.md'], true)), projects.map(() => true))
	for (const path of ['apps/finance/../README.md', 'apps/finance/a\\b.md', 'README.mdx']) assert.deepEqual(selected([path]), projects)
})

test('real Git Markdown PRs, deletions, renames and Vercel builds use the complete comparison', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-markdown-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const git = (...args) => execFileSync('git', ['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
	const commit = () => { git('add', '-A'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD') }
	const event = (base, head) => ({ pull_request: { base: { sha: base }, head: { sha: head } } })
	const ignore = (base, head, workdir = cwd) => spawnSync(process.execPath, [resolve(root, 'scripts/monorepo/vercel-ignore.mjs')], {
		cwd: workdir, encoding: 'utf8', env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_GIT_COMMIT_SHA: head },
	})
	git('init', '--quiet')
	writeFileSync(resolve(cwd, 'README.md'), 'original')
	const base = commit()
	renameSync(resolve(cwd, 'README.md'), resolve(cwd, 'Guide.MD'))
	const docs = commit()
	assert.deepEqual(Object.values(planForEvent('pull_request', event(base, docs), cwd).checks), projects.map(() => false))
	assert.equal(ignore(base, docs).status, 0)
	mkdirSync(resolve(cwd, 'apps/website'), { recursive: true })
	assert.equal(ignore(base, docs, resolve(cwd, 'apps/website')).status, 0)
	const eventPath = resolve(cwd, 'event.json'), output = resolve(cwd, 'output')
	writeFileSync(eventPath, JSON.stringify(event(base, docs)))
	const plan = spawnSync(process.execPath, [resolve(root, 'scripts/monorepo/ci.mjs')], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output } })
	assert.equal(plan.status, 0, plan.stderr)
	assert.match(readFileSync(output, 'utf8'), /markdown_only=true/u)
	rmSync(eventPath)
	rmSync(output)
	renameSync(resolve(cwd, 'Guide.MD'), resolve(cwd, 'app.js'))
	const code = commit()
	assert.deepEqual(Object.values(planForEvent('pull_request', event(docs, code), cwd).checks), projects.map(() => true))
	assert.equal(ignore(docs, code).status, 1)
	writeFileSync(resolve(cwd, 'notes.md'), 'documentation after code')
	const laterDocs = commit()
	assert.equal(ignore(docs, laterDocs).status, 1)
	assert.equal(ignore(code, laterDocs).status, 0)
	rmSync(resolve(cwd, 'notes.md'))
	const deleted = commit()
	assert.equal(ignore(laterDocs, deleted).status, 0)
	assert.equal(ignore(deleted, deleted).status, 1)
	for (const missing of ['', '0'.repeat(40), 'a'.repeat(40), '--help']) assert.equal(ignore(missing, deleted).status, 1)
})

test('every hosted Vercel project resolves the shared ignore script from its app root', () => {
	for (const app of ['apps/website', 'apps/finance', 'apps/clipper/apps/web', 'packages/ui']) {
		const config = JSON.parse(readFileSync(resolve(root, app, 'vercel.json'), 'utf8'))
		assert.equal(resolve(root, app, config.ignoreCommand.replace(/^node /u, '')), resolve(root, 'scripts/monorepo/vercel-ignore.mjs'))
	}
})
