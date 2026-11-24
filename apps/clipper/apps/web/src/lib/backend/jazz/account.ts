import { clearAtprotoAppSession } from 'delightful-local-first/auth/atproto/workflow'
import { jazzRuntimeSources } from './runtime-sources.js'
import { createLibraryCapability } from './library.js'
import { createLibraryBinding } from './library-binding.js'
import type { JazzClientConfig } from 'jazz-tools/client'
import { createJazzSessionRuntime } from 'delightful-local-first/backend/jazz/session-runtime'
import { parseJazzRecoveryPhrase } from 'delightful-local-first/backend/jazz/restoration'
import type { AccountCapabilities } from '../../contracts/account.js'

export type LibraryFactory = typeof createLibraryCapability

function nativeAccount(config: JazzClientConfig, libraryFactory: LibraryFactory) {
	const cacheNamespace = JSON.stringify([config.scope, config.serverUrl, config.env])
	return {
		native: createJazzSessionRuntime<AccountCapabilities>(
			{
				...config,
				runtimeSources: { ...jazzRuntimeSources, ...config.runtimeSources }
			},
			({ db, identityId, isCurrent, recovery }) => {
				const domain = createLibraryBinding({
					db,
					identityId,
					workspaceId: identityId,
					isCurrent,
					libraryFactory,
					cacheNamespace
				})
				return {
					root: domain.root,
					access: domain.access,
					recovery,
					createLibrary: domain.createLibrary
				}
			}
		),
		parsePhrase: parseJazzRecoveryPhrase,
		signOut: clearAtprotoAppSession
	}
}

/** Web first-use provisions silently; the existing store/config preserves identity. */
export function accountInput(
	config: JazzClientConfig,
	libraryFactory: LibraryFactory = createLibraryCapability
) {
	return nativeAccount({ ...config, initial: 'device' }, libraryFactory)
}

/** Extension connection requires an existing identity; never provision an unrelated account. */
export function existingAccountInput(
	config: JazzClientConfig,
	libraryFactory: LibraryFactory = createLibraryCapability
) {
	return nativeAccount(config, libraryFactory)
}
