import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const projects = ['website', 'ui', 'local_first', 'finance', 'clipper']

export function selectChecks(paths, forceAll = false) {
	const selected = new Set()
	for (const path of paths) {
		if (path.startsWith('apps/website/')) selected.add('website')
		else if (path.startsWith('apps/finance/')) selected.add('finance')
		else if (path.startsWith('apps/clipper/')) selected.add('clipper')
		else if (path.startsWith('packages/local-first/')) {
			for (const name of ['local_first', 'finance', 'clipper']) selected.add(name)
		} else if (path.startsWith('packages/ui/')) forceAll = true
		else forceAll = true
		if (path.includes('\\') || path.split('/').includes('..')) forceAll = true
	}
	return Object.fromEntries(projects.map((name) => [name, forceAll || selected.has(name)]))
}

export function validPrTitle(title) {
	return typeof title === 'string' && /^[a-z]+(?:\([^()\r\n]+\))?!?: [^\s].*$/u.test(title) && !/[\r\n]/u.test(title)
}

export function changedPaths(base, head, cwd, comparison = '...') {
	if (!['..', '...'].includes(comparison)) throw new Error('Invalid comparison')
	// Resolve commit objects before constructing a range; refs never become options.
	const commit = (ref) => execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
	const before = commit(base), after = commit(head)
	if (!/^[a-f0-9]{40,64}$/u.test(before) || !/^[a-f0-9]{40,64}$/u.test(after)) throw new Error('Invalid commit object')
	// Disabling rename collapsing includes both the old and new verification scopes.
	return execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', `${before}${comparison}${after}`, '--'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean)
}

export function planForEvent(eventName, event, cwd) {
	let base, head
	if (eventName === 'pull_request') {
		base = event.pull_request?.base?.sha
		head = event.pull_request?.head?.sha
	} else if (eventName === 'push') {
		base = event.before
		head = event.after
	}
	const validSha = (value) => typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value) && !/^0+$/u.test(value)
	if (!validSha(base) || !validSha(head)) return { checks: selectChecks([], true), reason: 'Manual event or unavailable comparison: all projects', paths: [] }
	try {
		const paths = changedPaths(base, head, cwd, eventName === 'push' ? '..' : '...')
		return { checks: selectChecks(paths), reason: 'Changed paths and transitive consumers', paths }
	} catch {
		return { checks: selectChecks([], true), reason: 'Comparison history unavailable: all projects', paths: [] }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
	if (process.argv.includes('--title')) {
		if (!validPrTitle(event.pull_request?.title)) {
			console.error('::error::Use a Conventional Commits PR title: type(scope): description. Scope is optional; ! marks a breaking change.')
			process.exitCode = 1
		}
	} else {
		const plan = planForEvent(process.env.GITHUB_EVENT_NAME, event, process.cwd())
		console.info(JSON.stringify(plan, null, 2))
		if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(plan.checks).map(([key, value]) => `${key}=${value}\n`).join(''))
	}
}
