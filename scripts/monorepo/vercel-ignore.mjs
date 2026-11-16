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

// Vercel: 0 cancels the build; 1 continues it. Compare with the last deployed
// commit so an intervening Markdown commit cannot hide undeployed code changes.
try {
	const base = process.env.VERCEL_GIT_PREVIOUS_SHA
	const head = process.env.VERCEL_GIT_COMMIT_SHA
	const validSha = (value) => typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value) && !/^0+$/u.test(value)
	if (!validSha(base) || !validSha(head)) throw new Error('No deployment comparison')
	const cwd = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
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
