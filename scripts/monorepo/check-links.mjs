import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const consumers = ['apps/finance', 'apps/clipper/apps/web', 'apps/clipper/apps/extension']
const peers = {
	'delightful-ui': ['svelte'],
	'delightful-local-first': ['svelte', 'jazz-tools/client', 'xstate', 'delightful-ui']
}

// Branded SDK types and Svelte snippets must come from the consumer's instance.
// Inspect actual installed resolution, including injected copies and peer contexts.
let failures = 0
for (const project of consumers) {
	const directory = resolve(root, project)
	const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
	const consumer = createRequire(resolve(directory, 'package.json'))
	for (const [name, requirements] of Object.entries(peers)) {
		if (manifest.dependencies?.[name] !== 'workspace:*') {
			console.error(`${project}: ${name} must use the workspace package`)
			failures++
			continue
		}
		const installed = realpathSync(resolve(directory, 'node_modules', name))
		const library = createRequire(resolve(installed, 'package.json'))
		let matches = true
		for (const peer of requirements) {
			const direct = realpathSync(consumer.resolve(peer))
			const nested = realpathSync(library.resolve(peer))
			if (direct !== nested) {
				console.error(`${project} → ${name}: different ${peer} instances\n  app: ${relative(root, direct)}\n  library: ${relative(root, nested)}`)
				failures++
				matches = false
			}
		}
		if (matches) console.info(`${project} → ${name}: shared ${requirements.join(', ')}`)
	}
}
if (failures) process.exitCode = 1
