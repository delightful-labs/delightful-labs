import type { z } from 'zod'
import { workspaceCreationAttemptSchema } from '../validation/identity.js'
import { stableUuid } from './stable-uuid.js'
import { workspaceStarterCategories } from './workspace-defaults.js'

export type WorkspaceCreationAttempt = z.infer<typeof workspaceCreationAttemptSchema>

/** Prepare once, then journal this payload before issuing writes. Retry the same payload. */
export async function prepareWorkspaceCreation(input: {
	organizationId: string
	userId: string
	profileId: string
	name: string
}): Promise<WorkspaceCreationAttempt> {
	const [membershipId, categories] = await Promise.all([
		stableUuid(input.organizationId, `owner:${input.userId}`),
		Promise.all(
			workspaceStarterCategories().map(async ({ key, ...category }) => ({
				...category,
				id: await stableUuid(input.organizationId, `category:${category.kind}:${key}`)
			}))
		)
	])
	return workspaceCreationAttemptSchema.parse({
		organizationId: input.organizationId,
		membershipId,
		profileId: input.profileId,
		workspace: {
			name: input.name,
			kind: 'personal',
			defaultCurrency: 'USD',
			ownerId: input.userId
		},
		categories
	})
}
