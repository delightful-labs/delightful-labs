import { createJazzAuthHandlers } from 'delightful-local-first/backend/jazz/auth'
import { configuredAuth } from './auth.js'
import type { CreateJazzOptions, Jazz } from 'jazz-tools/backend'
import { developmentJazz } from './jazz-development.js'
import { createJazz, memory, sqlite, vercel, perBranch } from 'jazz-tools/backend'
import { app } from '../queries.js'
import permissions from '../jazz.permissions.json' with { type: 'json' }

// Keep the qualified local store; Vercel uses the SDK's native environment/branch namespace.
const store = process.env.VERCEL
	? vercel({
			namespace: ({ environment, branch }) =>
				environment === 'production' ? 'production' : perBranch(branch),
			vcpus: 1,
			maxDriveBytes: 1024 ** 3,
			blobs: 'sqlite',
			idleMs: 60_000
		})
	: process.env.FINANCE_EPHEMERAL_JAZZ === 'true' || process.env.VITEST
		? memory()
		: sqlite({ path: '.jazz/alpha60/finance' })
const publicUrl = process.env.VERCEL
	? [
			process.env.VERCEL_URL,
			process.env.VERCEL_BRANCH_URL,
			process.env.VERCEL_PROJECT_PRODUCTION_URL,
			...(process.env.VERCEL_ENV === 'production' ? ['finance.delightfullabs.com'] : [])
		]
			.filter((host): host is string => Boolean(host))
			.map((host) => `https://${host}/jazz`)
	: undefined
if (publicUrl?.length === 0) throw new Error('Missing Vercel deployment audience')
const options = {
	app,
	permissions,
	store,
	...createJazzAuthHandlers(configuredAuth),
	...(publicUrl ? { publicUrl } : {})
} satisfies CreateJazzOptions
export const jazz: Jazz =
	process.env.FINANCE_EPHEMERAL_JAZZ === 'true'
		? developmentJazz(() => createJazz(options))
		: createJazz(options)
