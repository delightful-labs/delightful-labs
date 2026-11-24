import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// Run inside the proposed disposable Sandbox against native snapshot mounts.
// Reports only fixed metadata and totals; never opens Jazz or prints row data.
const root = resolve(process.argv[2] ?? '/retained')
const requested = process.argv.slice(3)
const destinations = requested.length ? requested : ['production', 'preview', 'qualification']
if (destinations.some((destination) => !/^[a-zA-Z0-9_-]+$/.test(destination)))
	throw new Error('Retained destination names must stay inside the snapshot root')
for (const destination of destinations) {
	const path = join(root, destination)
	const appId = (await readFile(join(path, 'app-id'), 'utf8')).trim()
	if (!appId) throw new Error(`Missing retained app identity: ${destination}`)
	const version = (await readFile(join(path, 'version'), 'utf8')).trim()
	if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version))
		throw new Error(`Invalid retained version: ${destination}`)
	const trust = (await readFile(join(path, 'trust'), 'utf8')).trim()
	if (!trust) throw new Error(`Missing retained trust: ${destination}`)
	const blobStore = await readFile(join(path, 'store/blob-store'), 'utf8')
		.then((value) => value.trim())
		.catch((error) => {
			if (error.code === 'ENOENT') return 'sqlite'
			throw error
		})
	if (blobStore !== 'files' && blobStore !== 'sqlite')
		throw new Error(`Retained snapshot needs complete local chunks: ${destination}`)
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
		JSON.stringify({
			destination,
			version,
			blobStore,
			appIdPresent: true,
			trustPresent: true,
			files,
			bytes
		})
	)
}
