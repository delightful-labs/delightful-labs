import { z } from 'zod'

import { workerCommandScope } from './worker-scope.js'
const scope = workerCommandScope.shape
/** Passwords and selected files use the private host boundary, never ordinary actor commands/views. */
export const financeBackupRequest = z.strictObject({
	type: z.literal('START_BACKUP'),
	...scope,
	protection: z.enum(['none', 'password']),
	password: z.string()
})
export const financeWorkspaceRestoreRequest = z.strictObject({
	type: z.literal('START_WORKSPACE_RESTORE'),
	...scope,
	file: z.file(),
	password: z.string()
})
export const financeDownloadRequest = z.strictObject({
	type: z.literal('DOWNLOAD_BACKUP'),
	bytes: z.instanceof(ArrayBuffer)
})
export const financeDownloadReply = z.strictObject({
	outcome: z.enum(['dispatched', 'rejected', 'unknown'])
})
export const workerBackupView = z
	.strictObject({
		editable: z.boolean(),
		canDownload: z.boolean(),
		canCancel: z.boolean(),
		canReload: z.boolean(),
		message: z
			.enum([
				'preparing',
				'downloaded',
				'cancelled',
				'permissionDenied',
				'dataChanged',
				'failed',
				'password'
			])
			.optional(),
		alert: z.boolean()
	})
	.transform((view) => ({ ...view, message: view.message }))
export const workerWorkspaceRestoreView = z
	.strictObject({
		alert: z.boolean(),
		busy: z.boolean(),
		editable: z.boolean(),
		canConfirm: z.boolean(),
		confirmAction: z.enum(['create', 'retry']),
		canCancel: z.boolean(),
		canRetryRelease: z.boolean(),
		canReload: z.boolean(),
		canOpen: z.boolean(),
		visibleOutsideSettings: z.boolean(),
		message: z
			.enum(['preparing', 'restoring', 'done', 'cancelled', 'failed', 'conflict'])
			.optional(),
		workspaceName: z.string().optional(),
		workspaceId: z.uuid().optional(),
		identityId: z.uuid().optional()
	})
	.transform((view) => ({
		...view,
		message: view.message,
		workspaceName: view.workspaceName,
		workspaceId: view.workspaceId,
		identityId: view.identityId
	}))
