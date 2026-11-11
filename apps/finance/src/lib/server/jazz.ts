import { developmentJazz } from './jazz-development.js'
import { acceptLocalFirstAuth, createJazz, memory, sqlite, vercel } from 'jazz-tools/backend'
import { app } from '../schema.js'
import permissions from '../permissions.js'

// A separate alpha.60 store: restore Finance's backup into the new target.
const store = process.env.VERCEL
	? vercel({
			vcpus: 1,
			maxDriveBytes: 1024 ** 3,
			blobs: 'sqlite',
			idleMs: 60_000,
			...(process.env.FINANCE_JAZZ_CORE_NAME ? { name: process.env.FINANCE_JAZZ_CORE_NAME } : {})
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
	authenticate: acceptLocalFirstAuth,
	...(publicUrl ? { publicUrl } : {})
}
export const jazz =
	process.env.FINANCE_EPHEMERAL_JAZZ === 'true'
		? developmentJazz(() => createJazz(options))
		: createJazz(options)
