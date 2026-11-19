import { z } from 'zod'

export const workerSelection = z.strictObject({
	workspaceId: z.uuid().nullable(),
	revision: z.number().int().nonnegative().safe()
})
export const workerSessionRevision = z.number().int().nonnegative().safe()
export const workerCommandScope = z.strictObject({
	sessionRevision: workerSessionRevision,
	selection: workerSelection
})
