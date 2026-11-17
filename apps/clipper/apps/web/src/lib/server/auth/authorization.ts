import { z } from 'zod'

export const identityAuthorizationScope = 'atproto'
export const publicationAuthorizationScope = 'atproto repo:at.margin.note'

export const authorizationScopeSchema = z
	.enum([identityAuthorizationScope, publicationAuthorizationScope])
	.default(identityAuthorizationScope)

/** Keep the plugin's existing handle/callback fields for its own validation. */
export const authorizationInputSchema = z.looseObject({ scope: authorizationScopeSchema })
