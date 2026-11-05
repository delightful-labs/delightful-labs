import { z } from 'zod'

const identifier = z.string().min(1).max(256)
export const backupBindingSchema = z
	.strictObject({
		applicationId: identifier,
		environment: identifier,
		identityId: identifier,
		workspaceId: identifier,
		generation: z.int().nonnegative(),
		operationId: identifier
	})
	.readonly()
export type BackupBinding = z.infer<typeof backupBindingSchema>

export function sameBackupBinding(left: BackupBinding, right: BackupBinding): boolean {
	return (
		left.applicationId === right.applicationId &&
		left.environment === right.environment &&
		left.identityId === right.identityId &&
		left.workspaceId === right.workspaceId &&
		left.generation === right.generation &&
		left.operationId === right.operationId
	)
}
