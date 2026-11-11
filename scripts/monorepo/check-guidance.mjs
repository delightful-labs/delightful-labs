import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const contexts = [
	['apps/website', 'apps/website'],
	['apps/finance', 'apps/finance'],
	['apps/clipper/apps/web', 'apps/clipper'],
	['apps/clipper/apps/extension', 'apps/clipper'],
	['packages/ui', '.'],
	['packages/local-first', 'packages/local-first']
]
export const topics = ['scope', 'state-machines', 'testing', 'localization', 'dependencies', 'accessibility', 'releases']
const localEntries = ['apps/website', 'apps/finance', 'apps/clipper', 'packages/ui', 'packages/local-first']

export function guidanceChain(root, context) {
	const result = []
	let current = resolve(root, context)
	while (current === root || (!relative(root, current).startsWith('..') && !isAbsolute(relative(root, current)))) {
		if (existsSync(resolve(current, 'AGENTS.md'))) result.unshift(relative(root, resolve(current, 'AGENTS.md')))
		if (current === root) break
		current = dirname(current)
	}
	return result
}

export function checkMarkdownLinks(root, files) {
	const errors = []
	for (const file of files) {
		const source = readFileSync(resolve(root, file), 'utf8').replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`+[^`\n]*`+/gu, '')
		for (const match of source.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/gu)) {
			const link = match[1].replace(/^<|>$/gu, '').split(/\s+["']/u)[0]
			if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(link)) continue
			const [path, anchor] = link.split('#')
			const target = resolve(root, dirname(file), decodeURIComponent(path))
			if (!existsSync(target)) { errors.push(`${file}: missing link ${link}`); continue }
			if (anchor && target.endsWith('.md')) {
				const headings = [...readFileSync(target, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gmu)].map((heading) => heading[1].toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/gu, '-'))
				if (!headings.includes(decodeURIComponent(anchor))) errors.push(`${file}: missing anchor ${link}`)
			}
		}
	}
	return errors
}

export function checkSharedOwnership(root) {
	const errors = []
	for (const project of ['apps/website', 'apps/finance', 'apps/clipper', 'packages/local-first']) {
		for (const part of ['scripts', 'templates']) {
			const local = resolve(root, project, '.specify', part)
			if (!existsSync(local) || realpathSync(local) !== realpathSync(resolve(root, '.specify', part))) errors.push(`Shared helper drift: ${project}/${part}`)
		}
	}
	for (const project of ['apps/finance', 'packages/local-first']) {
		const path = resolve(root, project, '.agents/skills')
		if (!existsSync(path) || realpathSync(path) !== realpathSync(resolve(root, '.agents/skills'))) errors.push(`Shared skill drift: ${project}`)
	}
	return errors
}

export function validFeature(root, project, feature) {
	return typeof feature === 'string' && !isAbsolute(feature) && feature.startsWith('specs/') && !feature.split('/').includes('..') && existsSync(resolve(root, project, feature, 'spec.md'))
}

export function checkGuidance(root, { discover = true } = {}) {
	root = resolve(root)
	const errors = []
	if (!existsSync(resolve(root, 'AGENTS.md')) || !existsSync(resolve(root, 'specs/002-monorepo-agent-guidance/guidance-disposition.json'))) return ['Missing guidance: root entry or disposition ledger']
	const ledger = JSON.parse(readFileSync(resolve(root, 'specs/002-monorepo-agent-guidance/guidance-disposition.json'), 'utf8'))
	const files = [...new Set(['AGENTS.md', ...topics.map((topic) => `docs/engineering/${topic}.md`), ...localEntries.map((entry) => `${entry}/AGENTS.md`), 'apps/finance/.specify/memory/xstate.md', 'packages/local-first/.specify/memory/xstate.md', 'apps/clipper/docs/memory/xstate.md', ...ledger.files.filter((file) => file.kind === 'guidance' && file.path.endsWith('.md')).map((file) => file.path)])]
	for (const file of files) if (!existsSync(resolve(root, file))) errors.push(`Missing guidance: ${file}`)
	if (errors.length) return errors
	errors.push(...checkMarkdownLinks(root, files))
	for (const topic of topics) if (!readFileSync(resolve(root, 'AGENTS.md'), 'utf8').includes(`docs/engineering/${topic}.md`)) errors.push(`Undiscoverable shared topic: ${topic}`)
	for (const entry of localEntries) if (!readFileSync(resolve(root, entry, 'AGENTS.md'), 'utf8').includes('../../AGENTS.md')) errors.push(`Missing root entry link: ${entry}`)
	for (const [context, project] of contexts) {
		const expected = ['AGENTS.md', `${project === '.' ? context : project}/AGENTS.md`]
		if (JSON.stringify(guidanceChain(root, context)) !== JSON.stringify(expected)) errors.push(`Unexpected instruction discovery: ${context}`)
	}
	errors.push(...checkSharedOwnership(root))
	const selectors = ['.', 'apps/website', 'apps/finance', 'apps/clipper', 'packages/local-first'].map((project) => {
		const path = resolve(root, project, '.specify/feature.json')
		const before = readFileSync(path, 'utf8')
		const feature = JSON.parse(before).feature_directory
		if (!validFeature(root, project, feature)) errors.push(`Invalid scoped feature: ${project}`)
		return { project, path, before, feature }
	})
	if (discover && !errors.length) {
		for (const [context, project] of contexts) {
			const selector = selectors.find((item) => item.project === project)
			const env = { ...process.env }
			delete env.SPECIFY_INIT_DIR
			delete env.SPECIFY_FEATURE
			delete env.SPECIFY_FEATURE_DIRECTORY
			env.SPECIFY_FEATURE_NO_PERSIST = '1'
			const result = JSON.parse(execFileSync('bash', [resolve(root, '.specify/scripts/bash/check-prerequisites.sh'), '--paths-only', '--json'], { cwd: resolve(root, context), env, encoding: 'utf8' }))
			if (result.FEATURE_DIR !== resolve(root, project, selector.feature)) errors.push(`Wrong feature discovery: ${context}`)
		}
	}
	for (const selector of selectors) if (readFileSync(selector.path, 'utf8') !== selector.before) errors.push(`Feature selector mutated: ${selector.project}`)
	for (const file of ledger.files) {
		if (!existsSync(resolve(root, file.defaultTarget))) errors.push(`Missing disposition target: ${file.defaultTarget}`)
		if (file.path.endsWith('.md') && !Array.isArray(ledger.ruleSets[file.ruleSet])) errors.push(`Missing rule inventory: ${file.path}`)
		for (const rule of ledger.ruleSets[file.ruleSet] ?? []) {
			const decision = ledger.decisions[rule.decision]
			if (!decision) errors.push(`Unresolved rule disposition: ${file.path}:${rule.line}`)
			else if (decision.target && !existsSync(resolve(root, decision.target))) errors.push(`Missing rule target: ${decision.target}`)
		}
	}
	return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
	const errors = checkGuidance(root)
	if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
	else console.info(`Shared guidance, links, helper ownership and read-only discovery verified in ${contexts.length} contexts.`)
}
