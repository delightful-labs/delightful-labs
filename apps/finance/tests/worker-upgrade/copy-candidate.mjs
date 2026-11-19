import { cpSync, existsSync, statSync } from 'node:fs'

/** Copy additions only: source drift must fail rather than replace maintained code. */
export function copyCandidate(source, target) {
	cpSync(source, target, {
		recursive: true,
		filter: (source, target) => {
			if (existsSync(target) && !statSync(source).isDirectory())
				throw new Error(`Candidate source already exists: ${target}`)
			return true
		}
	})
}
