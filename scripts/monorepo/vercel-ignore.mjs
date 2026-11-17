import { execFileSync } from 'node:child_process'
import { relative } from 'node:path'
import { changedPaths, markdownOnly, selectChecks } from './ci.mjs'
import { verificationOnlyPath } from './deployment-paths.mjs'

const projectRoots = {
	'apps/website': 'website',
	'apps/finance': 'finance',
	'apps/clipper/apps/web': 'clipper',
	'packages/ui': 'ui',
}

const validSha = (value) => typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value) && !/^0+$/u.test(value)

function comparisonBase(cwd, head) {
	const previous = process.env.VERCEL_GIT_PREVIOUS_SHA
	if (validSha(previous)) return previous
	// An invalid previous SHA is not evidence of a branch's first deployment.
	if (previous || process.env.VERCEL_ENV !== 'preview' ||
		!process.env.VERCEL_GIT_COMMIT_REF || process.env.VERCEL_GIT_COMMIT_REF === 'main') {
		throw new Error('No deployment comparison')
	}
	const deadline = Date.now() + 15_000
	const git = (args) => execFileSync('git', args, {
		cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: Math.max(1, deadline - Date.now()),
	}).trim()
	if (git(['rev-parse', '--verify', 'HEAD']) !== head) throw new Error('Deployment checkout mismatch')
	let source = 'origin'
	try {
		git(['remote', 'get-url', 'origin'])
	} catch {
		// Vercel may reconstruct Git metadata without any remotes. Its GitHub
		// system metadata identifies this public repository without credentials.
		const owner = process.env.VERCEL_GIT_REPO_OWNER
		const repo = process.env.VERCEL_GIT_REPO_SLUG
		if (process.env.VERCEL_GIT_PROVIDER !== 'github' ||
			typeof owner !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/u.test(owner) ||
			typeof repo !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(repo)) {
			throw new Error('No preview repository source')
		}
		source = `https://github.com/${owner}/${repo}.git`
	}
	// A new preview branch has no previous deployment. Compare its entire branch
	// delta, not HEAD^ (which loses earlier branch commits) or a stale main ref.
	// Main-only changes after branching do not make this preview affect that app.
	git(['fetch', '--no-tags', '--depth=1', source, 'refs/heads/main'])
	const main = git(['rev-parse', '--verify', '--end-of-options', 'FETCH_HEAD^{commit}'])
	if (!validSha(main)) throw new Error('No production branch comparison')
	let base
	try {
		base = git(['merge-base', '--all', main, head])
	} catch {
		// Vercel clones shallow history. Deepen the two pinned commits once;
		// unavailable/ambiguous ancestry still builds, within one time budget.
		git(['fetch', '--no-tags', '--deepen=100', source, main, head])
		base = git(['merge-base', '--all', main, head])
	}
	if (!validSha(base)) throw new Error('No unique preview merge base')
	console.info(`Using first-preview merge base ${base} (main ${main})`)
	return base
}

// Vercel: 0 cancels the build; 1 continues it. Existing branches retain the last
// successful deployment comparison, including every intervening skipped commit.
try {
	const head = process.env.VERCEL_GIT_COMMIT_SHA
	if (!validSha(head)) throw new Error('No deployment commit')
	const cwd = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
	const base = comparisonBase(cwd, head)
	const paths = changedPaths(base, head, cwd, '..')
	const projectRoot = relative(cwd, process.cwd())
	const project = Object.hasOwn(projectRoots, projectRoot) ? projectRoots[projectRoot] : undefined
	// Reuse the CI scopes: Clipper's parent tooling and extension remain one
	// scope, Local First affects both apps, and UI/unknown paths affect all.
	// Filter verification inputs only for deployment; leave CI selection intact.
	// An empty Git diff may be an intentional rebuild, so continue it.
	const docsOnly = markdownOnly(paths)
	const deploymentPaths = paths.filter((path) => !verificationOnlyPath(path, project))
	const verificationOnly = paths.length > 0 && project !== undefined && deploymentPaths.length === 0
	const unaffected = deploymentPaths.length > 0 && project !== undefined && !selectChecks(deploymentPaths)[project]
	const skip = docsOnly || verificationOnly || unaffected
	console.info(docsOnly ? 'Skipping Markdown-only deployment' : verificationOnly
		? 'Skipping test/tooling-only deployment' : unaffected
		? `Skipping unaffected ${project} deployment`
		: 'Building: affected project, explicit rebuild, or unknown project root')
	process.exitCode = skip ? 0 : 1
} catch {
	console.info('Building: deployment comparison unavailable')
	process.exitCode = 1
}
