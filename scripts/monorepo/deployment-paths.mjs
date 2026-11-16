// These paths affect verification/editor tooling, not deployed artifacts. Keep
// this separate from CI selection: test-only changes still need their checks.
const roots = [
	'apps/clipper/apps/web/', 'apps/clipper/apps/extension/', 'apps/clipper/',
	'apps/website/', 'apps/finance/', 'packages/local-first/', 'packages/ui/',
]

export function verificationOnlyPath(path, project) {
	if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..' || part === '.')) return false
	if (/\.md$/iu.test(path)) return true
	if (path.startsWith('.github/workflows/') || path.startsWith('.vscode/')) return true
	const root = roots.find((prefix) => path.startsWith(prefix))
	const local = root ? path.slice(root.length) : path
	// Static assets and ordinary build configuration always require deployment.
	if (local.startsWith('static/')) return false
	if (root && (local.startsWith('tests/') || local.startsWith('__tests__/'))) return true
	if (root === 'packages/local-first/' && local.startsWith('fixtures/')) return true
	if (root === 'apps/finance/' && local.startsWith('tooling/worker-state-tests/')) return true
	if ((root || path.startsWith('scripts/')) && /\.(?:test|spec|test-support)\.[cm]?[jt]sx?$/u.test(local)) return true
	// UI Storybook is itself hosted: its inputs are deployable for UI, but do
	// not change the UI library consumed by the website, Finance, or Clipper.
	if (root === 'packages/ui/' && (local.startsWith('.storybook/') || local.startsWith('src/stories/'))) return project !== 'ui'
	// Restrict setting-name matches to known package roots (or repository root),
	// not arbitrary runtime files whose names happen to resemble tooling.
	if (local.includes('/')) return false
	if (/^(?:\.editorconfig|\.prettierignore|\.eslintignore|\.prettierrc(?:\.(?:json|ya?ml|[cm]?js))?|\.(?:oxfmt|oxlint)rc\.json)$/u.test(local)) return true
	if (/^(?:prettier|eslint|playwright|vitest)(?:\.[\w-]+)*\.config\.[cm]?[jt]s$/u.test(local)) return true
	// These are verification-only configs, not the tsconfig/vite configs used
	// by the production compiler, packaging, or service worker builds.
	return root === 'apps/finance/' && /^(?:vite\.(?:e2e|worker-proof)\.config\.ts|tsconfig\.worker-(?:host|proof)\.json|\.full-e2e(?:-retry)?\.config\.ts)$/u.test(local)
		|| root === 'packages/local-first/' && /^tsconfig\.(?:xstate|sign-out)-tests\.json$/u.test(local)
}
