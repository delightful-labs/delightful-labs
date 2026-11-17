import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Check the actual Clipper host and startup chart against the same candidate packages. */
export function checkClipper(directory, proof, clipper) {
	const app = join(directory, 'clipper')
	mkdirSync(app)
	const run = (command, args) => execFileSync(command, args, { cwd: app, stdio: 'inherit' })
	const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
	cpSync(join(clipper, 'apps/web/src/lib'), join(app, 'apps/web/src/lib'), { recursive: true })
	cpSync(join(clipper, 'apps/web/src/app.d.ts'), join(app, 'apps/web/src/app.d.ts'))
	cpSync(join(clipper, 'vitest.config.ts'), join(app, 'vitest.config.ts'))
	run('git', [
		'apply',
		'--directory=apps/web',
		'--check',
		'--whitespace=error-all',
		join(proof, 'clipper-session.patch')
	])
	run('git', ['apply', '--directory=apps/web', join(proof, 'clipper-session.patch')])
	const versions = clipperProofVersions(clipper)
	json(join(app, 'package.json'), {
		name: 'clipper-jazz-upgrade-proof',
		private: true,
		type: 'module',
		pnpm: { overrides: { '@opentelemetry/api': versions['@opentelemetry/api'] } },
		dependencies: {
			...versions,
			'jazz-tools': 'file:../candidate-sdk.tgz',
			'delightful-local-first': 'file:../adapted-local-first.tgz'
		}
	})
	writeFileSync(join(app, '.npmrc'), 'auto-install-peers=false\n')
	json(join(app, 'tsconfig.json'), {
		compilerOptions: {
			target: 'ES2024',
			module: 'ESNext',
			moduleResolution: 'Bundler',
			lib: ['ES2024', 'DOM', 'DOM.Iterable'],
			strict: true,
			exactOptionalPropertyTypes: true,
			noUncheckedIndexedAccess: true,
			skipLibCheck: true,
			resolveJsonModule: true,
			noEmit: true,
			types: ['node', 'vite/client']
		},
		include: [
			'apps/web/src/app.d.ts',
			'apps/web/src/lib/localization/i18next.d.ts',
			'apps/web/src/lib/backend/jazz/account.ts',
			'apps/web/src/lib/machines/runtime/application-readiness.test.ts',
			'apps/web/src/lib/runtime/worker/host-bindings.test.ts',
			'apps/web/src/lib/runtime/worker/host-machine.test.ts'
		]
	})
	run('pnpm', ['install', '--ignore-scripts'])
	const candidate = createRequire(join(app, 'package.json'))
	const wasm = createRequire(candidate.resolve('jazz-tools/package.json'))
	const jazzVersion = candidate('jazz-tools/package.json').version
	const wasmVersion = wasm('jazz-wasm/package.json').version
	if (jazzVersion !== '2.0.0-alpha.65' || wasmVersion !== jazzVersion)
		throw new Error('Clipper SDK/Wasm version mismatch')
	json(join(app, 'versions.json'), { ...versions, jazz: jazzVersion, wasm: wasmVersion })
	run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.json'])
	run('pnpm', [
		'exec',
		'vitest',
		'run',
		'--config',
		'vitest.config.ts',
		'apps/web/src/lib/machines/runtime/application-readiness.test.ts',
		'apps/web/src/lib/machines/runtime/root-bootstrap.test.ts',
		'apps/web/src/lib/machines/runtime/sign-out.test.ts',
		'apps/web/src/lib/runtime/worker/host-bindings.test.ts',
		'apps/web/src/lib/runtime/worker/host-machine.test.ts'
	])
}

export function clipperProofVersions(clipper) {
	const packages = [
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
