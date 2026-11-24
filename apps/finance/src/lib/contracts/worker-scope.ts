import { z } from 'zod'

export const workerWorkspaceActivation = z.strictObject({
	attachment: z.number().int().positive().safe(),
	epoch: z.number().int().positive().safe()
})

export const workerSelection = z.strictObject({
	workspaceId: z.uuid().nullable(),
	revision: z.number().int().nonnegative().safe(),
	activation: workerWorkspaceActivation.optional()
})
export const workerSessionRevision = z.number().int().nonnegative().safe()
export const workerCommandScope = z.strictObject({
	sessionRevision: workerSessionRevision,
	selection: workerSelection
})

/** Correlation of public transport facts, not a permission grant. */
export function sameWorkerWorkspaceActivation(
	left: z.output<typeof workerSelection>,
	right: z.output<typeof workerSelection>
) {
	return (
		left.activation !== undefined &&
		right.activation !== undefined &&
		left.activation.attachment === right.activation.attachment &&
		left.activation.epoch === right.activation.epoch
	)
}
