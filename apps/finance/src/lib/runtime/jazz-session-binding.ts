import type { JazzClient, JazzSession } from 'jazz-tools/client'
import {
	bindWorkspaceRestoreResource,
	type WorkspaceRestoreBinding,
	type WorkspaceRestoreFile,
	type WorkspaceRestoreConfiguration
} from '../machines/workspaces/workspace-restore.js'

export type FinanceSession = JazzSession<JazzClient>

/** Native SDK reads stay here; application charts consume identity facts and domain bindings. */
export function financeSessionIdentityId(session: FinanceSession | undefined) {
	const state = session?.getSnapshot()
	return state?.status === 'ready' && state.account && state.client ? state.account.id : undefined
}
export function workspaceRestoreSessionReady(session: FinanceSession | undefined) {
	return financeSessionIdentityId(session) !== undefined
}
export function observeFinanceMutationRejections(
	session: FinanceSession,
	notify: (transactionId: string) => void
) {
	const db = session.getSnapshot().client?.db
	return db?.onMutationError((rejection) => notify(rejection.transaction.transactionId))
}

export function bindWorkspaceRestoreFile(
	request: WorkspaceRestoreFile,
	session: FinanceSession,
	config: WorkspaceRestoreConfiguration
) {
	const state = session.getSnapshot()
	if (state.status !== 'ready' || !state.account || !state.client)
		throw new Error('Restore session unavailable')
	const account = state.account,
		client = state.client,
		db = client.db
	const binding: WorkspaceRestoreBinding = {
		identityId: account.id,
		db,
		subscribe: (notify) => session.subscribe(notify),
		isCurrent: () => {
			const now = session.getSnapshot()
			return (
				now.status === 'ready' &&
				now.account === account &&
				now.client === client &&
				now.client.db === db
			)
		}
	}
	bindWorkspaceRestoreResource(request, binding, config)
}
