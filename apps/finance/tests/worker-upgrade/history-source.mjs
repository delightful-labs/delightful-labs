import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

/** Freeze the historical producer; an SDK upgrade must not rewrite its comparison baseline. */
export function copyHistoricalSource(source, target) {
	const workspace = resolve(source, source.endsWith('/apps/web') ? '../../../..' : '../..')
	const path = relative(workspace, source)
	const archive = execFileSync(
		'git',
		['archive', '51b8e8780526eef299c2093e7528ae013515eca7', '--', `${path}/src`],
		{ cwd: workspace, maxBuffer: 32 * 1024 * 1024 }
	)
	execFileSync('tar', ['-x', '-C', target, '--strip-components', String(path.split('/').length)], {
		input: archive
	})
}
