import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { portRuntimeImports } from './schema.mjs'

/** Actual Finance Worker/UI slice on the same isolated native SDK and generated schema. */
export function checkFinanceWorker(directory, finance, proof) {
	const app = join(directory, 'app')
	const run = (command, args) => execFileSync(command, args, { cwd: app, stdio: 'inherit' })
	for (const name of [
		'src/lib/runtime/worker/recovery.ts',
		'src/lib/runtime/worker/navigation.ts',
		'src/lib/machines/workspaces/workspace-navigation.ts',
		'src/lib/contracts/workspace-orchestration-contract.ts',
		'src/lib/domain/workspace-routes.ts',
		'src/lib/domain/query-params.ts',
		'src/lib/domain/transaction-kind.ts',
		'src/lib/components/workspaces/WorkspaceScopeNotice.svelte',
		'src/lib/components/navigation/AppLink.svelte',
		'src/lib/components/navigation/Anchor.svelte',
		'src/lib/filters/query-links.ts',
		'src/lib/contracts/worker-recovery.ts',
		'src/lib/components/worker/WorkerRecovery.svelte',
		'src/lib/components/worker/WorkerLogin.svelte',
		'src/lib/components/identity/LoginForm.svelte',
		'src/lib/machines/workspaces/workspace-initialization.ts',
		'src/lib/machines/workspaces/workspace-creation-transaction.ts',
		'src/lib/diagnostics/error-details.ts',
		'src/lib/machines/runtime/worker-ledger.ts',
		'src/lib/components/worker/WorkerLedger.svelte',
		'src/lib/components/transactions/TransactionListView.svelte',
		'src/lib/components/transactions/TransactionListItem.svelte',
		'src/lib/domain/transaction-groups.ts',
		'src/lib/filters/transaction-list-filters.ts',
		'src/lib/validation/transactions.ts',
		'src/lib/contracts/worker-application.ts',
		'src/lib/contracts/worker-forms.ts',
		'src/lib/contracts/transaction-entry-contract.ts',
		'src/lib/machines/runtime/worker-queries.ts',
		'src/lib/machines/transactions/transaction-entry.ts',
		'src/lib/components/worker/WorkerTransactionEntry.svelte',
		'src/lib/components/transactions/TransactionForm.svelte',
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
	cpSync(
		join(proof, 'candidate/worker/application.worker.ts'),
		join(app, 'src/lib/runtime/worker/application.worker.ts')
	)
	portRuntimeImports(join(app, 'src/lib'), join(app, 'src/lib'), 'queries.js', false)
	portRuntimeImports(
		join(app, 'tests/worker-application'),
		join(app, 'src/lib'),
		'queries.js',
		false
	)
	// This maintained browser fixture also compiles with the active alpha.60 types.
	// The isolated candidate uses the corresponding native device-account API/policies.
	const nativeTests = join(app, 'tests/worker-application/native.test.ts')
	writeFileSync(
		nativeTests,
		readFileSync(nativeTests, 'utf8')
			.replaceAll('acceptLocalFirstAuth', 'acceptDeviceAccounts')
			.replace(
				"import permissions from '../../src/lib/permissions.js'",
				"import permissions from '../../src/lib/jazz.permissions.json' with { type: 'json' }"
			)
	)
	writeFileSync(
		join(app, 'tsconfig.worker-application.json'),
		JSON.stringify(
			{
				extends: './tsconfig.json',
				compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' },
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
