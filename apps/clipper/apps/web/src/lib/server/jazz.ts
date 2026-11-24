import { createJazzAuthHandlers } from 'delightful-local-first/backend/jazz/auth'
import { configuredAuth } from './auth/handler.js'
import { extensionOrigin } from '../../../../../tooling/extension-identity.js'
import { createJazz, memory, perBranch, remote, sqlite, vercel } from 'jazz-tools/backend'
import { app } from '../backend/jazz/jazz.generated.js'
import permissions from '../backend/jazz/jazz.permissions.json' with { type: 'json' }

// Jazz owns lazy acquisition, schema publication, sockets, and core lifecycle.
// The local alpha.60 store has a separate path from the previous SDK's data.
const store = process.env.VERCEL
	? vercel({
			region: 'iad1',
			vcpus: 1,
			maxDriveBytes: 1024 ** 3,
			blobs: 'sqlite',
			idleMs: 60_000,
			namespace: ({ environment, branch }) =>
				environment === 'production' ? 'production' : perBranch(branch)
		})
	: process.env.CLIPPER_TEST === 'true' && process.env.CLIPPER_TEST_CORE_URL
		? remote({
				url: process.env.CLIPPER_TEST_CORE_URL,
				appId: process.env.PUBLIC_JAZZ_APP_ID ?? '',
				secret: process.env.CLIPPER_TEST_CORE_SECRET ?? ''
			})
		: process.env.CLIPPER_EPHEMERAL_JAZZ === 'true' || process.env.VITEST
			? memory()
			: sqlite({ path: '.jazz/alpha60/clipper.sqlite' })

// Production admission must not trust caller-controlled forwarding headers.
const publicUrl = process.env.VERCEL
	? [
			process.env.VERCEL_URL,
			process.env.VERCEL_BRANCH_URL,
			process.env.VERCEL_PROJECT_PRODUCTION_URL,
			...(process.env.VERCEL_ENV === 'production'
				? ['clipper.delightfullabs.com', 'delightful-clipper.vercel.app']
				: [])
		]
			.filter((host): host is string => Boolean(host))
			.map((host) => `https://${host}/jazz`)
	: undefined
if (publicUrl?.length === 0) throw new Error('Missing Vercel deployment audience')
export const jazz = createJazz({
	app,
	permissions,
	store,
	...createJazzAuthHandlers(configuredAuth),
	allowedOrigins: [extensionOrigin],
	...(publicUrl ? { publicUrl } : {})
})
