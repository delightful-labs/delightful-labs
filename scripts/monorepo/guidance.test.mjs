import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkGuidance, checkMarkdownLinks, checkSharedOwnership, contexts, guidanceChain, validFeature } from './check-guidance.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

test('all six product contexts discover shared and scoped guidance without changing feature selectors', () => {
	const selectors = ['.', 'apps/website', 'apps/finance', 'apps/clipper', 'packages/local-first'].map((project) => resolve(root, project, '.specify/feature.json'))
	const before = selectors.map((path) => readFileSync(path, 'utf8'))
	assert.deepEqual(checkGuidance(root), [])
	assert.deepEqual(selectors.map((path) => readFileSync(path, 'utf8')), before)
	assert.equal(contexts.length, 6)
	for (const [context, project] of contexts) {
		assert.deepEqual(guidanceChain(root, context), ['AGENTS.md', `${project === '.' ? context : project}/AGENTS.md`])
	}
	assert.match(readFileSync(resolve(root, 'AGENTS.md'), 'utf8'), /No constitution is globally adopted/u)
})

test('guidance links detect missing files and anchors while respecting external links and code examples', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-guidance-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	writeFileSync(resolve(cwd, 'AGENTS.md'), '[valid](guide.md#working-rules) [external](https://example.invalid/a)\n```md\n[example](missing.md)\n```\n`m["noun"]({ count: 2 })`\n')
	writeFileSync(resolve(cwd, 'guide.md'), '# Working rules\n')
	assert.deepEqual(checkMarkdownLinks(cwd, ['AGENTS.md']), [])
	writeFileSync(resolve(cwd, 'AGENTS.md'), '[broken](absent.md) [anchor](guide.md#absent)')
	assert.deepEqual(checkMarkdownLinks(cwd, ['AGENTS.md']), ['AGENTS.md: missing link absent.md', 'AGENTS.md: missing anchor guide.md#absent'])
})

test('instruction discovery includes nested overrides and rejects paths outside the workspace', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-discovery-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	mkdirSync(resolve(cwd, 'apps/example/src'), { recursive: true })
	for (const path of ['AGENTS.md', 'apps/example/AGENTS.md', 'apps/example/src/AGENTS.md']) writeFileSync(resolve(cwd, path), '# context')
	assert.deepEqual(guidanceChain(cwd, 'apps/example/src'), ['AGENTS.md', 'apps/example/AGENTS.md', 'apps/example/src/AGENTS.md'])
	assert.deepEqual(guidanceChain(cwd, '../outside'), [])
	assert.ok(checkGuidance(cwd, { discover: false }).some((error) => error.startsWith('Missing guidance:')))
})


test('shared helper and skill ownership rejects copied or broken replacements', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-ownership-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	for (const path of ['.specify/scripts', '.specify/templates', '.agents/skills']) mkdirSync(resolve(cwd, path), { recursive: true })
	for (const project of ['apps/website', 'apps/finance', 'apps/clipper', 'packages/local-first']) {
		mkdirSync(resolve(cwd, project, '.specify'), { recursive: true })
		for (const part of ['scripts', 'templates']) symlinkSync(resolve(cwd, '.specify', part), resolve(cwd, project, '.specify', part))
	}
	for (const project of ['apps/finance', 'packages/local-first']) {
		mkdirSync(resolve(cwd, project, '.agents'), { recursive: true })
		symlinkSync(resolve(cwd, '.agents/skills'), resolve(cwd, project, '.agents/skills'))
	}
	assert.deepEqual(checkSharedOwnership(cwd), [])
	rmSync(resolve(cwd, 'apps/finance/.agents/skills'))
	mkdirSync(resolve(cwd, 'apps/finance/.agents/skills'))
	rmSync(resolve(cwd, 'apps/website/.specify/templates'))
	symlinkSync(resolve(cwd, 'missing'), resolve(cwd, 'apps/website/.specify/templates'))
	assert.deepEqual(checkSharedOwnership(cwd), ['Shared helper drift: apps/website/templates', 'Shared skill drift: apps/finance'])
})

test('feature selectors must stay within their owning project', (t) => {
	const cwd = mkdtempSync(resolve(tmpdir(), 'delightful-selector-'))
	t.after(() => rmSync(cwd, { recursive: true, force: true }))
	mkdirSync(resolve(cwd, 'apps/example/specs/001-local'), { recursive: true })
	writeFileSync(resolve(cwd, 'apps/example/specs/001-local/spec.md'), '# Local feature')
	assert.equal(validFeature(cwd, 'apps/example', 'specs/001-local'), true)
	for (const feature of ['specs/../other/specs/001-local', '/specs/001-local', undefined, 'specs/missing']) assert.equal(validFeature(cwd, 'apps/example', feature), false)
	assert.equal(validFeature(cwd, 'apps/sibling', 'specs/001-local'), false)
})


test('read-only discovery ignores inherited feature overrides and cannot persist them', () => {
	const selectors = ['.', 'apps/website', 'apps/finance', 'apps/clipper', 'packages/local-first'].map((project) => resolve(root, project, '.specify/feature.json'))
	const before = selectors.map((path) => readFileSync(path, 'utf8'))
	const result = spawnSync(process.execPath, [resolve(root, 'scripts/monorepo/check-guidance.mjs')], {
		cwd: root, encoding: 'utf8', env: { ...process.env, SPECIFY_INIT_DIR: '/missing-project', SPECIFY_FEATURE: 'unrelated-feature', SPECIFY_FEATURE_DIRECTORY: '/missing-feature', SPECIFY_FEATURE_NO_PERSIST: 'false' }
	})
	assert.equal(result.status, 0, result.stderr)
	assert.deepEqual(selectors.map((path) => readFileSync(path, 'utf8')), before)
})
