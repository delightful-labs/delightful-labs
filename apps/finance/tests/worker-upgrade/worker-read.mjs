import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Actual Finance Worker/UI slice on the same isolated native SDK and generated schema. */
export function checkFinanceWorker(directory, finance, proof) {
	const app = join(directory, 'app')
	const run = (command, args) => execFileSync(command, args, { cwd: app, stdio: 'inherit' })
	for (const name of [
		'src',
		'tooling',
		'tests/worker-application',
		'vitest.worker-application.config.ts'
	]) {
		mkdirSync(dirname(join(app, name)), { recursive: true })
		cpSync(join(finance, name), join(app, name), { recursive: true })
	}
	// This fixture supplies service-worker framework modules in native.test.ts.
	// Its standalone project has no SvelteKit-generated $app/tsconfig package.
	writeFileSync(
		join(app, 'src/service-worker/tsconfig.json'),
		JSON.stringify(
			{
				extends: '../../tsconfig.json',
				compilerOptions: {
					module: 'ESNext',
					moduleResolution: 'Bundler',
					lib: ['ES2024', 'WebWorker']
				},
				include: ['./**/*.ts']
			},
			null,
			2
		) + '\n'
	)

	writeFileSync(
		join(app, 'tsconfig.worker-application.json'),
		JSON.stringify(
			{
				extends: './tsconfig.json',
				compilerOptions: {
					module: 'ESNext',
					moduleResolution: 'Bundler',
					paths: { '$app/state': ['./tests/worker-application/route-state.svelte.ts'] }
				},
				include: [
					'src/app.d.ts',
					'src/lib/tdesign-icons.d.ts',
					'src/lib/runtime/worker/application.worker.ts',
					'src/lib/data/accounts.ts',
					'src/lib/runtime/worker/client.ts',
					'src/lib/components/worker/WorkerAccounts.svelte',
					'src/lib/components/accounts/AccountSelection.svelte',
					'src/lib/filters/finance-filters.ts',
					'tests/worker-application/**/*.ts',
					'tooling/jazz-wasm.ts',
					'vitest.worker-application.config.ts'
				]
			},
			null,
			2
		) + '\n'
	)
	run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.worker-application.json'])
	run('pnpm', [
		'exec',
		'svelte-check',
		'--tsconfig',
		'./tsconfig.worker-application.json',
		'--fail-on-warnings'
	])
	run('pnpm', [
		'exec',
		'vitest',
		'run',
		'--config',
		'vitest.worker-application.config.ts',
		'--reporter=verbose'
	])
}
