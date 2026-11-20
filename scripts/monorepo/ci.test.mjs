import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { changedPaths, planForEvent, projects, selectChecks, validPrTitle } from './ci.mjs'
import { verificationOnlyPath } from './deployment-paths.mjs'

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
			assert.match(body, /^    needs: (?:plan|\[plan(?:, [\w-]+)*\])$/mu)
			if (name === 'finance' && job === 'browser') {
				assert.match(body, /needs: \[plan, browser_build\]/u)
				assert.match(body, /if: \$\{\{ matrix.reuse_build && needs.browser_build.result != 'success' \}\}\n        run: exit 1/u)
			}
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

test('Finance upload ignore rules preserve Git metadata required before build selection', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-vercel-upload-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	execFileSync('git', ['init', '--quiet'], { cwd })
	// Vercel applies .vercelignore before its Ignored Build Step. Exercise the
	// actual ignore file with Git's ignore matcher, including nested objects.
	const check = spawnSync('git', ['-c', `core.excludesFile=${resolve(root, 'apps/finance/.vercelignore')}`, 'check-ignore', '--no-index', '--', '.git/HEAD', '.git/config', '.git/objects/pack/fixture.pack'], { cwd, encoding: 'utf8' })
	assert.equal(check.status, 1, `Build comparison metadata must survive upload filtering: ${check.stdout}${check.stderr}`)
	const secrets = spawnSync('git', ['-c', `core.excludesFile=${resolve(root, 'apps/finance/.vercelignore')}`, 'check-ignore', '--no-index', '--', '.env', '.env.production'], { cwd, encoding: 'utf8' })
	assert.equal(secrets.status, 0)
	assert.deepEqual(secrets.stdout.trim().split('\n'), ['.env', '.env.production'], 'local environment files remain excluded')
})

test('Vercel skips unrelated apps using complete deployed-to-current Git changes', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-vercel-scopes-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	const roots = ['apps/website', 'apps/finance', 'apps/clipper/apps/web', 'packages/ui']
	const git = (...args) => execFileSync('git', ['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
	const put = (path) => { mkdirSync(dirname(resolve(cwd, path)), { recursive: true }); writeFileSync(resolve(cwd, path), 'fixture') }
	const commit = () => { git('add', '-A'); git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD') }
	const ignore = (base, head, app) => spawnSync(process.execPath, [resolve(root, 'scripts/monorepo/vercel-ignore.mjs')], {
		cwd: resolve(cwd, app), encoding: 'utf8', env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_GIT_COMMIT_SHA: head },
	})
	const statuses = (base, head) => roots.map((app) => ignore(base, head, app).status)
	git('init', '--quiet')
	for (const app of roots) put(`${app}/base.txt`)
	const base = commit()
	// Exit 1 means build; exit 0 means skip. Expectations are deployment
	// behavior, exercised through the real CLI/Git boundary before any install.
	for (const [path, expected] of [
		['apps/website/src/page.svelte', [1, 0, 0, 0]],
		['apps/finance/src/page.svelte', [0, 1, 0, 0]],
		['apps/clipper/apps/web/src/page.svelte', [0, 0, 1, 0]],
		['apps/clipper/tooling/build.mjs', [0, 0, 1, 0]],
		['apps/clipper/apps/extension/src/popup.ts', [0, 0, 1, 0]],
		['packages/local-first/src/index.ts', [0, 1, 1, 0]],
		['packages/ui/src/Button.svelte', [1, 1, 1, 1]],
		['pnpm-lock.yaml', [1, 1, 1, 1]],
		['scripts/new-build.mjs', [1, 1, 1, 1]],
		['README.md', [0, 0, 0, 0]],
		['apps/finance/src/lib/machines/setup.test.ts', [0, 0, 0, 0]],
		['apps/finance/src/lib/runtime/worker.test-support.ts', [0, 0, 0, 0]],
		['apps/finance/tests/helpers/ui.ts', [0, 0, 0, 0]],
		['apps/finance/tooling/worker-state-tests/package.json', [0, 0, 0, 0]],
		['apps/clipper/apps/web/src/lib/policy.spec.ts', [0, 0, 0, 0]],
		['apps/clipper/apps/web/tests/fixtures/Host.svelte', [0, 0, 0, 0]],
		['packages/local-first/fixtures/package-consumer/consumer.ts', [0, 0, 0, 0]],
		['packages/local-first/tests/fixtures/archive.json', [0, 0, 0, 0]],
		['packages/ui/src/button.test.js', [0, 0, 0, 0]],
		['packages/ui/tests/fixtures/Host.svelte', [0, 0, 0, 0]],
		['scripts/monorepo/ci.test.mjs', [0, 0, 0, 0]],
		['apps/finance/vitest.worker-host.config.ts', [0, 0, 0, 0]],
		['apps/clipper/playwright.worker.config.ts', [0, 0, 0, 0]],
		['apps/finance/vite.e2e.config.ts', [0, 0, 0, 0]],
		['apps/finance/tsconfig.worker-host.json', [0, 0, 0, 0]],
		['packages/local-first/tsconfig.xstate-tests.json', [0, 0, 0, 0]],
		['apps/finance/.prettierrc.json', [0, 0, 0, 0]],
		['packages/ui/eslint.config.js', [0, 0, 0, 0]],
		['apps/clipper/.oxlintrc.json', [0, 0, 0, 0]],
		['.editorconfig', [0, 0, 0, 0]],
		['.vscode/settings.json', [0, 0, 0, 0]],
		['.github/workflows/ci.yml', [0, 0, 0, 0]],
		['apps/finance/vite.config.ts', [0, 1, 0, 0]],
		['apps/finance/tsconfig.json', [0, 1, 0, 0]],
		['apps/finance/src/service-worker/tsconfig.json', [0, 1, 0, 0]],
		['apps/finance/package.json', [0, 1, 0, 0]],
		['apps/finance/tooling/jazz-wasm.ts', [0, 1, 0, 0]],
		['apps/finance/static/example.test.js', [0, 1, 0, 0]],
		['apps/finance/custom.config.ts', [0, 1, 0, 0]],
		['packages/local-first/tsconfig.library.json', [0, 1, 1, 0]],
		['packages/ui/.storybook/main.js', [0, 0, 0, 1]],
		['packages/ui/src/stories/Button.stories.svelte', [0, 0, 0, 1]],
		['scripts/monorepo/ci.mjs', [0, 0, 0, 0]],
		['scripts/monorepo/vercel-ignore.mjs', [0, 0, 0, 0]],
		['scripts/monorepo/deployment-paths.mjs', [0, 0, 0, 0]],
	]) {
		git('checkout', '--detach', base)
		put(path)
		const head = commit()
		assert.deepEqual(statuses(base, head), expected, path)
		if (path === 'apps/finance/src/page.svelte') {
			put('apps/finance/notes.md')
			const docs = commit()
			assert.deepEqual(statuses(base, docs), [0, 1, 0, 0], 'later docs cannot hide undeployed Finance code')
			assert.deepEqual(statuses(head, docs), [0, 0, 0, 0], 'already deployed code needs no rebuild')
			assert.equal(ignore(base, head, '.').status, 1, 'unknown app root builds')
		}
	}
	git('checkout', '--detach', base)
	renameSync(resolve(cwd, 'apps/website/base.txt'), resolve(cwd, 'apps/finance/moved.txt'))
	const renamed = commit()
	assert.deepEqual(statuses(base, renamed), [1, 1, 0, 0], 'rename affects both old and new app')
	rmSync(resolve(cwd, 'apps/finance/moved.txt'))
	const deleted = commit()
	assert.deepEqual(statuses(renamed, deleted), [0, 1, 0, 0], 'deletion rebuilds its app')
	assert.deepEqual(statuses(deleted, deleted), [1, 1, 1, 1], 'explicit rebuild continues')
	for (const missing of ['', '0'.repeat(40), 'a'.repeat(40), '--help']) {
		assert.deepEqual(statuses(missing, deleted), [1, 1, 1, 1], 'missing/invalid history builds every app')
	}
	git('checkout', '--detach', base)
	put('apps/finance/tests/helpers/ui.ts')
	put('apps/clipper/playwright.config.ts')
	put('README.md')
	const verification = commit()
	assert.deepEqual(statuses(base, verification), [0, 0, 0, 0], 'mixed tests, tooling and Markdown skip')
	assert.deepEqual(statuses('', verification), [1, 1, 1, 1], 'verification-only first deployment still builds')
	put('apps/website/src/app.ts')
	const runtime = commit()
	assert.deepEqual(statuses(base, runtime), [1, 0, 0, 0], 'only runtime consumer builds in a mixed change')
	put('apps/website/tests/app.test.ts')
	const laterTest = commit()
	assert.deepEqual(statuses(verification, laterTest), [1, 0, 0, 0], 'test fix cannot hide earlier undeployed runtime code')
	assert.deepEqual(statuses(runtime, laterTest), [0, 0, 0, 0])
	renameSync(resolve(cwd, 'apps/website/src/app.ts'), resolve(cwd, 'apps/website/tests/moved.test.ts'))
	const runtimeToTest = commit()
	assert.deepEqual(statuses(laterTest, runtimeToTest), [1, 0, 0, 0], 'moving runtime code to tests removes a deployed input')
	renameSync(resolve(cwd, 'apps/website/tests/moved.test.ts'), resolve(cwd, 'apps/finance/new-runtime.ts'))
	const testToRuntime = commit()
	assert.deepEqual(statuses(runtimeToTest, testToRuntime), [0, 1, 0, 0], 'moving a test into runtime deploys its new consumer')
	rmSync(resolve(cwd, 'apps/finance/tests/helpers/ui.ts'))
	assert.deepEqual(statuses(testToRuntime, commit()), [0, 0, 0, 0], 'test deletion needs no deployment')
})

test('deployment-only exclusions keep CI active and reject ambiguous paths', () => {
	for (const path of ['apps/finance/src/lib/setup.test.ts', 'apps/finance/tests/helpers/ui.ts', 'apps/finance/.prettierrc.json']) {
		assert.equal(verificationOnlyPath(path, 'finance'), true)
		assert.equal(selectChecks([path]).finance, true, 'deployment skipping must not skip Finance CI')
	}
	for (const path of ['', '/apps/finance/tests/app.ts', 'apps/finance/../tests/a.ts', 'apps/finance/./tests/a.ts', 'apps/finance/tests/a\\b.ts', 'unknown/tests/app.ts', 'apps/finance/src/lib/custom.config.ts', 'apps/finance/src/lib/tests-helper.ts', 'apps/finance/tsconfig.json']) {
		assert.equal(verificationOnlyPath(path, 'finance'), false, path)
	}
	for (const path of ['scripts/monorepo/ci.mjs', 'scripts/monorepo/vercel-ignore.mjs', 'scripts/monorepo/deployment-paths.mjs']) {
		assert.equal(verificationOnlyPath(path, 'website'), true)
		assert.deepEqual(Object.values(selectChecks([path])), projects.map(() => true), 'deployment controls retain all CI verification')
	}
	assert.equal(verificationOnlyPath('scripts/new-build.mjs', 'website'), false)
	assert.equal(verificationOnlyPath('apps/website/src/vercel-ignore.mjs', 'website'), false)
})

function previewFixture(t) {
	const directory = mkdtempSync(resolve(tmpdir(), 'delightful-first-preview-'))
	t.after(() => rmSync(directory, { recursive: true, force: true }))
	const seed = resolve(directory, 'seed'), origin = resolve(directory, 'origin.git')
	mkdirSync(seed)
	const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=CI Test', '-c', 'user.email=ci@example.invalid', '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
		cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
	}).trim()
	const put = (path, contents = 'fixture') => { mkdirSync(dirname(resolve(seed, path)), { recursive: true }); writeFileSync(resolve(seed, path), contents) }
	const commit = () => { git(seed, 'add', '-A'); git(seed, 'commit', '-m', 'fixture'); return git(seed, 'rev-parse', 'HEAD') }
	const roots = ['apps/website', 'apps/finance', 'apps/clipper/apps/web', 'packages/ui']
	git(seed, 'init', '--quiet', '--initial-branch=main')
	for (const app of roots) {
		put(`${app}/base.txt`)
		put(`${app}/package.json`, '{}')
	}
	const base = commit()
	git(directory, 'init', '--bare', '--quiet', '--initial-branch=main', origin)
	git(seed, 'remote', 'add', 'origin', origin)
	git(seed, 'push', '--quiet', 'origin', 'main')
	const branch = (name) => git(seed, 'checkout', '-B', name, base)
	const clone = (name) => {
		git(seed, 'push', '--quiet', 'origin', name)
		const cwd = resolve(directory, name)
		git(directory, 'clone', '--quiet', '--depth=1', '--branch', name, pathToFileURL(origin).href, cwd)
		assert.equal(git(cwd, 'rev-parse', '--is-shallow-repository'), 'true')
		assert.throws(() => git(cwd, 'rev-parse', '--verify', 'refs/remotes/origin/main'), 'a fresh Vercel-like branch has no local main ref')
		return cwd
	}
	const ignore = (cwd, app, metadata = {}) => spawnSync(process.execPath, [resolve(root, 'scripts/monorepo/vercel-ignore.mjs')], {
		cwd: resolve(cwd, app), encoding: 'utf8', env: {
			...process.env, VERCEL_ENV: 'preview', VERCEL_GIT_PREVIOUS_SHA: '',
			VERCEL_GIT_PROVIDER: '', VERCEL_GIT_REPO_OWNER: '', VERCEL_GIT_REPO_SLUG: '',
			VERCEL_GIT_COMMIT_REF: 'feature', VERCEL_GIT_COMMIT_SHA: git(cwd, 'rev-parse', 'HEAD'), ...metadata,
		},
	})
	const statuses = (cwd, metadata) => roots.map((app) => ignore(cwd, app, metadata).status)
	return { directory, seed, origin, base, roots, git, put, commit, branch, clone, ignore, statuses }
}

test('first shallow preview branches select affected apps without a previous deployment, including the PR 45 paths', (t) => {
	const f = previewFixture(t)
	for (const [name, paths, expected] of [
		['website', ['apps/website/vercel.json', 'apps/website/README.md'], [1, 0, 0, 0]],
		['finance', ['apps/finance/src/app.ts'], [0, 1, 0, 0]],
		['clipper', ['apps/clipper/apps/web/src/app.ts'], [0, 0, 1, 0]],
		['extension', ['apps/clipper/apps/extension/src/app.ts'], [0, 0, 1, 0]],
		['local-first', ['packages/local-first/src/index.ts'], [0, 1, 1, 0]],
		['ui', ['packages/ui/src/Button.svelte'], [1, 1, 1, 1]],
		['root', ['pnpm-lock.yaml'], [1, 1, 1, 1]],
		['deployment-controls', ['scripts/monorepo/ci.mjs', 'scripts/monorepo/vercel-ignore.mjs', 'scripts/monorepo/deployment-paths.mjs'], [0, 0, 0, 0]],
		['docs', ['README.md'], [0, 0, 0, 0]],
		['verification', ['apps/finance/src/setup.test.ts', 'apps/finance/.prettierrc.json', 'apps/clipper/playwright.config.ts'], [0, 0, 0, 0]],
	]) {
		f.branch(name)
		for (const path of paths) f.put(path)
		f.commit()
		// A later Markdown commit must not conceal the earlier branch changes.
		f.put('branch-notes.md', name)
		f.commit()
		const cwd = f.clone(name)
		assert.deepEqual(f.statuses(cwd), expected, name)
		assert.match(f.ignore(cwd, f.roots[0]).stdout, new RegExp(`Using first-preview merge base ${f.base}`, 'u'))
	}
})

test('first preview comparison fetches authoritative main, covers renames/deletions and excludes main-only changes', (t) => {
	const f = previewFixture(t)
	f.branch('renamed')
	renameSync(resolve(f.seed, 'apps/website/base.txt'), resolve(f.seed, 'apps/finance/moved.txt'))
	f.commit()
	const renamed = f.clone('renamed')
	assert.deepEqual(f.statuses(renamed), [1, 1, 0, 0])
	f.branch('deleted')
	rmSync(resolve(f.seed, 'apps/finance/base.txt'))
	f.commit()
	assert.deepEqual(f.statuses(f.clone('deleted')), [0, 1, 0, 0])
	f.branch('website')
	f.put('apps/website/src/app.ts')
	const head = f.commit()
	const cwd = f.clone('website')
	f.git(cwd, 'update-ref', 'refs/remotes/origin/main', head)
	assert.deepEqual(f.statuses(cwd), [1, 0, 0, 0], 'a stale local main cannot hide the branch change')
	f.git(f.seed, 'checkout', 'main')
	f.put('apps/finance/src/new-on-main.ts')
	const main = f.commit()
	f.git(f.seed, 'push', '--quiet', 'origin', 'main')
	assert.deepEqual(f.statuses(cwd), [1, 0, 0, 0], 'newer Finance code only on main is not a website branch change')
	assert.match(f.ignore(cwd, 'apps/finance').stdout, new RegExp(`merge base ${f.base} \\(main ${main}\\)`, 'u'))
})

test('first preview fallback never overrides deployed history, production, explicit rebuilds or failed comparisons', (t) => {
	const f = previewFixture(t)
	f.branch('finance')
	f.put('apps/finance/src/app.ts')
	const runtime = f.commit()
	f.put('notes.md')
	const head = f.commit()
	assert.deepEqual(f.statuses(f.seed, { VERCEL_GIT_PREVIOUS_SHA: f.base }), [0, 1, 0, 0], 'all undeployed commits remain in the comparison')
	assert.deepEqual(f.statuses(f.seed, { VERCEL_GIT_PREVIOUS_SHA: runtime }), [0, 0, 0, 0], 'already deployed runtime followed by docs skips')
	assert.deepEqual(f.statuses(f.seed, { VERCEL_GIT_PREVIOUS_SHA: head }), [1, 1, 1, 1], 'an explicit rebuild remains a build')
	for (const metadata of [
		{ VERCEL_ENV: 'production' }, { VERCEL_ENV: '' }, { VERCEL_GIT_COMMIT_REF: 'main' },
		{ VERCEL_GIT_COMMIT_REF: '' }, { VERCEL_GIT_COMMIT_SHA: f.base },
		...['0'.repeat(40), 'a'.repeat(40), '--help'].map((sha) => ({ VERCEL_GIT_PREVIOUS_SHA: sha })),
	]) assert.deepEqual(f.statuses(f.seed, metadata), [1, 1, 1, 1], JSON.stringify(metadata))
	const cwd = f.clone('finance')
	f.git(cwd, 'remote', 'set-url', 'origin', resolve(f.directory, 'unavailable.git'))
	assert.deepEqual(f.statuses(cwd), [1, 1, 1, 1], 'failed main fetch builds rather than guessing')
})

test('Vercel reconstructed checkouts without origin use validated GitHub metadata', (t) => {
	const f = previewFixture(t)
	f.branch('reconstructed')
	f.put('apps/website/vercel.json')
	f.commit()
	f.put('README.md')
	f.commit()
	const cwd = f.clone('reconstructed')
	f.git(cwd, 'remote', 'remove', 'origin')
	f.git(cwd, 'branch', '-m', 'master')
	assert.equal(f.git(cwd, 'remote'), '')
	assert.deepEqual(f.git(cwd, 'for-each-ref', '--format=%(refname)').split('\n'), ['refs/heads/master'])
	// Keep this native Git test offline while exercising the constructed URL.
	f.git(cwd, 'config', `url.${pathToFileURL(f.origin).href}.insteadOf`, 'https://github.com/delightful-labs/delightful-labs.git')
	const metadata = { VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'delightful-labs', VERCEL_GIT_REPO_SLUG: 'delightful-labs' }
	assert.deepEqual(f.statuses(cwd, metadata), [1, 0, 0, 0])
	for (const changed of [
		{ VERCEL_GIT_PROVIDER: 'gitlab' }, { VERCEL_GIT_REPO_OWNER: '' },
		{ VERCEL_GIT_REPO_OWNER: 'invalid/owner' }, { VERCEL_GIT_REPO_SLUG: '../repo' },
		{ VERCEL_GIT_REPO_SLUG: '' }, { VERCEL_GIT_REPO_SLUG: 'repo?token=anything' },
	]) assert.deepEqual(f.statuses(cwd, { ...metadata, ...changed }), [1, 1, 1, 1], 'unavailable or malformed repository metadata builds')
})
