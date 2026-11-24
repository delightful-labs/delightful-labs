import { setup, types, type SnapshotFrom } from 'xstate'
import type { z } from 'zod'
import type {
	workerProfile,
	workerWorkspaceSettings,
	WorkerWorkspace
} from '../../contracts/worker-application.js'
import type { ArchiveObservation } from '../accounts/account-archive-operation.js'
import { observeFinanceQuery, type FinanceWorkerReady } from './worker-query-observation.js'

export type WorkspaceAccessRows = {
	profile: z.output<typeof workerProfile> | null | undefined
	workspace: z.output<typeof workerWorkspaceSettings> | null | undefined
	workspaces: WorkerWorkspace[] | null
	membership: ArchiveObservation['membership']
}
type Input = {
	ready: FinanceWorkerReady
	workspaceId: string | null
	binding: object
	initialWorkspaces: WorkspaceAccessRows['workspaces']
	initialProfile?: WorkspaceAccessRows['profile']
	initialMembership?: WorkspaceAccessRows['membership']
	reportDisposalFailure: () => void
}
const empty: WorkspaceAccessRows = {
	profile: undefined,
	workspace: undefined,
	workspaces: null,
	membership: undefined
}
const profile = observeFinanceQuery<WorkspaceAccessRows['profile']>('PROFILE')
const workspace = observeFinanceQuery<WorkspaceAccessRows['workspace']>('WORKSPACE')
const workspaces = observeFinanceQuery<WorkerWorkspace[]>('WORKSPACES')
const membership = observeFinanceQuery<WorkspaceAccessRows['membership']>('MEMBERSHIP')

/** Native access evidence remains observable independently of content eligibility. */
export const financeWorkspaceAccessMachine = setup({
	schemas: {
		input: types<Input>(),
		context: types<Input & WorkspaceAccessRows>(),
		events: {
			PROFILE: types<{ binding: object; rows: WorkspaceAccessRows['profile'] }>(),
			WORKSPACE: types<{ binding: object; rows: WorkspaceAccessRows['workspace'] }>(),
			WORKSPACES: types<{ binding: object; rows: WorkerWorkspace[] }>(),
			MEMBERSHIP: types<{ binding: object; rows: WorkspaceAccessRows['membership'] }>(),
			READ_FAILED: types<{ binding: object }>()
		}
	},
	actors: { profile, workspace, workspaces, membership }
}).createMachine({
	id: 'finance-workspace-access',
	initial: 'running',
	context: ({ input }) => ({
		...input,
		...empty,
		profile: input.initialProfile,
		membership: input.initialMembership,
		workspaces: input.initialWorkspaces
	}),
	states: {
		running: {
			invoke: [
				{
					src: 'profile',
					input: ({ context }) => ({
						...context,
						observe: context.ready.capabilities.observeProfile
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'workspace',
					input: ({ context }) => ({
						...context,
						observe: context.workspaceId
							? context.ready.capabilities.observeWorkspace.bind(null, context.workspaceId)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'workspaces',
					input: ({ context }) => ({
						...context,
						observe: context.ready.capabilities.observeWorkspaces
					}),
					onError: { target: 'failed', context: empty }
				},
				{
					src: 'membership',
					input: ({ context }) => ({
						...context,
						observe: context.workspaceId
							? context.ready.capabilities.observeMembership.bind(null, context.workspaceId)
							: undefined
					}),
					onError: { target: 'failed', context: empty }
				}
			],
			on: {
				PROFILE: ({ context, event }) =>
					event.binding === context.binding ? { context: { profile: event.rows } } : undefined,
				WORKSPACE: ({ context, event }) =>
					event.binding === context.binding ? { context: { workspace: event.rows } } : undefined,
				WORKSPACES: ({ context, event }) =>
					event.binding === context.binding ? { context: { workspaces: event.rows } } : undefined,
				MEMBERSHIP: ({ context, event }) =>
					event.binding === context.binding ? { context: { membership: event.rows } } : undefined,
				READ_FAILED: ({ context, event }) =>
					event.binding === context.binding ? { target: 'failed', context: empty } : undefined
			}
		},
		failed: {}
	}
})

export type WorkspaceAccessFacts = WorkspaceAccessRows & {
	binding: object
	status: 'observing' | 'failed'
}
/** Correlated facts only; presence in the directory does not grant target access. */
export function selectFinanceWorkspaceAccessFacts(
	snapshot: SnapshotFrom<typeof financeWorkspaceAccessMachine>
): WorkspaceAccessFacts {
	const failed = snapshot.status !== 'active' || snapshot.matches('failed')
	const rows = failed ? empty : snapshot.context
	return {
		binding: snapshot.context.binding,
		status: failed ? 'failed' : 'observing',
		profile: rows.profile,
		workspace: rows.workspace,
		workspaces: rows.workspaces,
		membership: rows.membership
	}
}

/** Existing Finance membership predicate, shared by navigation and lease evidence. */
export function financeMembershipAccess(
	identityId: string | null | undefined,
	workspaceId: string | null | undefined,
	membership: WorkspaceAccessRows['membership']
): 'ready' | 'waiting' | 'denied' {
	if (membership === undefined) return 'waiting'
	if (!membership || !identityId || !workspaceId) return 'denied'
	return membership?.userId === identityId && membership?.organizationId === workspaceId
		? 'ready'
		: 'denied'
}
export function financeWorkspaceAccess(
	identityId: string | null | undefined,
	workspaceId: string | null,
	access: WorkspaceAccessFacts | undefined
): 'allowed' | 'denied' | 'unknown' | 'failed' {
	if (access?.status === 'failed') return 'failed'
	const membership = financeMembershipAccess(identityId, workspaceId, access?.membership)
	return membership === 'ready' ? 'allowed' : membership === 'waiting' ? 'unknown' : 'denied'
}
