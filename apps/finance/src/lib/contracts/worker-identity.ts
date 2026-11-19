import { z } from 'zod'
import { appProfileSchema, appWorkspaceSchema } from '../validation/identity.js'
export const workerProfile = appProfileSchema
	.pick({ userId: true, displayName: true, avatarData: true, avatarMimeType: true })
	.extend({ id: z.uuid(), displayName: z.string().nullable().optional() })
export const workerWorkspaceSettings = appWorkspaceSchema.extend({ id: z.uuid() })
