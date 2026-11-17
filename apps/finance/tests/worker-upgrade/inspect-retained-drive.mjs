import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Run inside the proposed disposable Sandbox against native snapshot mounts.
// Reports only fixed metadata and totals; never opens Jazz or prints row data.
const root = resolve(process.argv[2] ?? '/retained')
for (const destination of ['production', 'preview', 'qualification']) {
	const path = join(root, destination)
	const appId = (await readFile(join(path, 'app-id'), 'utf8')).trim()
	if (!appId) throw new Error(`Missing retained app identity: ${destination}`)
	const version = (await readFile(join(path, 'version'), 'utf8')).trim()
	if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
		throw new Error(`Invalid retained version: ${destination}`)
	const trust = (await readFile(join(path, 'trust'), 'utf8')).trim()
	if (!trust) throw new Error(`Missing retained trust: ${destination}`)
	let files = 0
	let bytes = 0
	async function count(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const file = join(directory, entry.name)
			if (entry.isDirectory()) await count(file)
			else if (entry.isFile()) {
				files += 1
				bytes += (await stat(file)).size
			} else throw new Error(`Unexpected retained store entry: ${destination}`)
		}
	}
	await count(join(path, 'store'))
	if (files === 0 || bytes === 0) throw new Error(`Empty retained store: ${destination}`)
	console.log(
		JSON.stringify({ destination, version, appIdPresent: true, trustPresent: true, files, bytes })
	)
}
