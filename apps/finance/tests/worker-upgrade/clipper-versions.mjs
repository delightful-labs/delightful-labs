import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function clipperProofVersions(clipper) {
	const packages = [
		'@atcute/lexicons',
		'@atcute/tid',
		'@faker-js/faker',
		'i18next',
		'unicode-case-folding',
		'zod',
		'xstate',
		'svelte',
		'vite',
		'vitest',
		'typescript',
		'@types/node',
		'@opentelemetry/api',
		'ws'
	]
	const installed = ['apps/web', '.'].flatMap((path) =>
		JSON.parse(
			execFileSync('pnpm', ['list', ...packages, '--depth', '0', '--json'], {
				cwd: join(clipper, path),
				encoding: 'utf8'
			})
		)
	)
	return Object.fromEntries(
		packages.map((name) => {
			const dependency = installed
				.map((project) => project.dependencies?.[name] ?? project.devDependencies?.[name])
				.find(Boolean)
			if (!dependency) throw new Error(`Installed Clipper dependency missing: ${name}`)
			return [name, dependency.version]
		})
	)
}
