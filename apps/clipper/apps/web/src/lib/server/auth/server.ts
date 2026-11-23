import { createAtprotoAuthServer } from 'delightful-local-first/backend/jazz/auth'
import type { Db, BackendSchemaInput } from 'jazz-tools/backend'
import { identityAuthorizationScope, publicationAuthorizationScope } from './authorization.js'

export { authConfiguration } from 'delightful-local-first/backend/jazz/auth'
export function createAuthServer(
	storage: { db: () => Db | Promise<Db>; schema: BackendSchemaInput },
	input: { origin: string; secret: string }
) {
	return createAtprotoAuthServer(storage, input, {
		clientName: 'Delightful Clipper',
		authorizationScopes: [identityAuthorizationScope, publicationAuthorizationScope],
		defaultAuthorizationScope: publicationAuthorizationScope
	})
}
