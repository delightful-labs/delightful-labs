import { execFileSync } from 'node:child_process'
import { changedPaths, markdownOnly } from './ci.mjs'

// Vercel: 0 cancels the build; 1 continues it. Compare with the last deployed
// commit so an intervening Markdown commit cannot hide undeployed code changes.
try {
	const base = process.env.VERCEL_GIT_PREVIOUS_SHA
	const head = process.env.VERCEL_GIT_COMMIT_SHA
	const validSha = (value) => typeof value === 'string' && /^[a-f0-9]{40,64}$/u.test(value) && !/^0+$/u.test(value)
	if (!validSha(base) || !validSha(head)) throw new Error('No deployment comparison')
	const cwd = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
	const skip = markdownOnly(changedPaths(base, head, cwd, '..'))
	console.info(skip ? 'Skipping Markdown-only deployment' : 'Building non-Markdown changes')
	process.exitCode = skip ? 0 : 1
} catch {
	console.info('Building: deployment comparison unavailable')
	process.exitCode = 1
}
