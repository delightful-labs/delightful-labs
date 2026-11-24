import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Run in the disposable Sandbox; private digests/key never leave its scratch space.
const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(process.argv[2] ?? '/retained')
const requested = process.argv.slice(3)
const destinations = requested.length ? requested : ['production', 'preview', 'qualification']
if (destinations.some((destination) => !/^[a-zA-Z0-9_-]+$/.test(destination)))
	throw new Error('Retained destination names must stay inside the snapshot root')
const scratch = await mkdtemp(join(directory, 'comparison-'))
const keyFile = join(scratch, 'key')
await writeFile(keyFile, randomBytes(32), { mode: 0o600 })
try {
	for (const destination of destinations) {
		const results = []
		for (const version of ['alpha67', 'beta1']) {
			const work = join(scratch, destination + '-' + version)
			const output = work + '.json'
			try {
				execFileSync(
					process.execPath,
					[
						join(directory, version, 'retained-read.mjs'),
						join(root, destination),
						work,
						output,
						keyFile
					],
					{ stdio: 'pipe', timeout: 60000 }
				)
			} catch {
				// Native errors may contain records or credentials. Keep raw logs out of output.
				throw new Error(`Retained reader failed: ${destination}, ${version}`)
			}
			results.push(JSON.parse(await readFile(output, 'utf8')))
		}
		const baseline = results[0]
		const summaries = results.slice(1).map((candidate) => ({
			version: candidate.version,
			identityMatches: candidate.identityPreserved && candidate.appIdProof === baseline.appIdProof,
			tables: baseline.tables.map((table) => {
				const next = candidate.tables.find((item) => item.name === table.name)
				return {
					name: table.name,
					rows: table.rows,
					byteCells: table.byteCells,
					byteLength: table.byteLength,
					rowsMatch: next?.rows === table.rows && next.digest === table.digest,
					bytesMatch:
						next?.byteCells === table.byteCells &&
						next.byteLength === table.byteLength &&
						next.bytesDigest === table.bytesDigest
				}
			})
		}))
		console.log(JSON.stringify({ destination, comparisons: summaries }))
		if (
			summaries.some(
				(result) =>
					!result.identityMatches ||
					result.tables.some((table) => !table.rowsMatch || !table.bytesMatch)
			)
		)
			throw new Error(`Retained comparison differs: ${destination}`)
	}
} finally {
	await rm(scratch, { recursive: true, force: true })
}
