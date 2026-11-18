import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Actual Finance Worker/UI slice on the same isolated native SDK and generated schema. */
export function checkFinanceWorker(directory, finance, proof) {
	const app = join(directory, 'app')
	const run = (command, args) => execFileSync(command, args, { cwd: app, stdio: 'inherit' })
	for (const name of [
		'src/lib/contracts/worker-application.ts',
		'src/lib/contracts/worker-forms.ts',
		'src/lib/contracts/account-creation-contract.ts',
		'src/lib/contracts/form-contract.ts',
		'src/lib/validation/accounts.ts',
		'src/lib/machines/accounts/account-creation-access.ts',
		'src/lib/machines/runtime/worker-forms.ts',
		'src/lib/machines/forms/scoped-form.ts',
		'src/lib/machines/forms/form-feedback.ts',
		'src/lib/forms/form-dependencies.ts',
		'src/lib/forms/form-messages.ts',
		'src/lib/components/accounts/AccountForm.svelte',
		'src/lib/components/forms/FormFeedback.svelte',
		'src/lib/components/worker/WorkerAccountCreation.svelte',
		'src/lib/contracts/account-archive-feedback.ts',
		'src/lib/tdesign-icons.d.ts',
		'src/lib/machines/accounts/account-archive.ts',
		'src/lib/machines/accounts/account-archive-operation.ts',
		'src/lib/components/accounts/AccountArchiveButton.svelte',
		'src/lib/components/accounts/AccountArchiveFeedback.svelte',
		'src/lib/data/accounts.ts',
		'src/lib/domain/required.ts',
		'src/lib/machines/runtime/worker-application.ts',
		'src/lib/runtime/worker/application.worker.ts',
		'src/lib/runtime/worker/client.ts',
		'src/lib/runtime/worker/binding.ts',
		'src/lib/components/worker/WorkerAccounts.svelte',
		'src/lib/components/workspaces/WorkspaceSelector.svelte',
		'src/lib/paraglide',
		'tooling/jazz-wasm.ts',
		'tests/worker-application',
		'vitest.worker-application.config.ts'
	]) {
		mkdirSync(dirname(join(app, name)), { recursive: true })
		cpSync(join(finance, name), join(app, name), { recursive: true })
	}
	run('git', ['apply', '--check', '--whitespace=error-all', join(proof, 'finance-worker.patch')])
	run('git', ['apply', join(proof, 'finance-worker.patch')])
	for (const name of [
		'src/lib/runtime/worker/binding.ts',
		'src/lib/data/accounts.ts',
		'src/lib/machines/accounts/account-archive-operation.ts',
		'src/lib/machines/runtime/worker-forms.ts',
		'src/lib/contracts/account-creation-contract.ts',
		'src/lib/machines/accounts/account-creation-access.ts',
		'tests/worker-application/read-binding.ts'
	]) {
		const path = join(app, name)
		writeFileSync(path, readFileSync(path, 'utf8').replace(/schema\.js/g, 'queries.js'))
	}
	writeFileSync(
		join(app, 'tsconfig.worker-application.json'),
		JSON.stringify(
			{
				extends: './tsconfig.json',
				include: [
					'src/lib/tdesign-icons.d.ts',
					'src/lib/runtime/worker/application.worker.ts',
					'src/lib/data/accounts.ts',
					'src/lib/runtime/worker/client.ts',
					'src/lib/components/worker/WorkerAccounts.svelte',
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
	run('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.worker-application.config.ts'])
}
