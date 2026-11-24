import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type { DetachedTransaction } from 'delightful-local-first/workspace/creation/contracts'
import { ReadTier, PersistedWriteRejectedError, type Db as JazzDb } from 'jazz-tools'
import { setup, types, type OutputFrom } from 'xstate'
import { app, type Organization } from '../../queries.js'
import { ACCOUNT_ACCESS } from '../../domain/account-access.js'
import { ORGANIZATION_ROLE } from '../../domain/organization-role.js'
import type { WorkspaceCreationAttempt } from '../../domain/workspace-creation.js'
import { workspaceCreationAttemptSchema } from '../../validation/identity.js'

type Db = Pick<JazzDb, 'beginSerializableTransaction'>
type Transaction = ReturnType<Db['beginSerializableTransaction']>
type Write = ReturnType<Transaction['commit']>
type Draft = { db: Db; request: WorkspaceCreationAttempt }
type Input = { db: Db; attempt: WorkspaceCreationAttempt; purpose?: 'bootstrap' | 'additional' }
const detached = new WeakMap<object, Set<DetachedTransaction<Transaction, Write>>>()

// The canonical private profile is the initialization reservation. Its absence
// is the serializable read guard; native inserts atomically protect every graph ID.
async function read(transaction: Transaction, { draft }: { draft: Draft }) {
	const request = draft.request
	const profile = await transaction.one(
		app.profiles.where({ id: request.profileId, userId: request.workspace.ownerId }),
		{ tier: ReadTier.LocalFirst }
	)
	return { profile }
}

const transaction = createWorkspaceCreationTransaction<
	Draft,
	Transaction,
	Awaited<ReturnType<typeof read>>,
	Organization,
	Write
>({
	open: ({ draft }) => draft.db.beginSerializableTransaction(),
	retainDetached: (receipt, { draft }) => {
		const retained = detached.get(draft.db) ?? new Set()
		retained.add(receipt)
		detached.set(draft.db, retained)
	},
	readLocal: read,
	assess: (records) => {
		if (records.profile) return { outcome: 'blocked', reason: 'profileUnavailable' }
		return { outcome: 'eligible' }
	},
	stage: (resource, { draft }) => {
		const request = workspaceCreationAttemptSchema.parse(draft.request)
		resource.insert(
			app.profiles,
			{ userId: request.workspace.ownerId, initialWorkspaceId: request.organizationId },
			{ id: request.profileId }
		)
		const workspace = resource.insert(app.organizations, request.workspace, {
			id: request.organizationId
		})
		resource.insert(
			app.organizationMembers,
			{
				organizationId: request.organizationId,
				userId: request.workspace.ownerId,
				profileId: request.profileId,
				role: ORGANIZATION_ROLE.OWNER,
				accountAccessMode: ACCOUNT_ACCESS.ALL
			},
			{ id: request.membershipId }
		)
		for (const { id, ...category } of request.categories)
			resource.insert(
				app.categories,
				{ ...category, organizationId: request.organizationId },
				{ id }
			)
		return workspace
	},
	commit: (resource) => resource.commit(),
	authority: {
		confirm: (write) => write.wait(),
		isRejected: (error) => error instanceof PersistedWriteRejectedError
	},
	rollback: (resource) => resource.rollback()
})

type Persistence =
	| { outcome: 'succeeded'; settlement: 'authorityAccepted'; workspace: Organization }
	| { outcome: 'profileUnavailable' | 'conflict'; settlement: 'notStarted' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved' | 'rejected'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement:
				'notStarted' | 'locallyPersisted' | 'authorityAccepted' | 'unresolved' | 'rejected'
	  }
function result(output: OutputFrom<typeof transaction>): Persistence {
	if (output.outcome === 'succeeded')
		return {
			outcome: 'succeeded',
			settlement: 'authorityAccepted',
			workspace: output.settlement.workspace
		}
	if (output.outcome === 'blocked')
		return {
			outcome: output.reason === 'profileUnavailable' ? 'profileUnavailable' : 'conflict',
			settlement: 'notStarted'
		}
	if (output.outcome === 'failed')
		return { outcome: 'failed', settlement: output.settlement.kind, error: output.error }
	return { outcome: output.outcome, settlement: output.settlement.kind }
}
export function classifyBootstrapConcurrency(output: Persistence) {
	if (output.outcome === 'profileUnavailable' || output.outcome === 'conflict') return 'notStarted'
	if (
		output.outcome === 'failed' &&
		output.settlement === 'rejected' &&
		output.error instanceof PersistedWriteRejectedError &&
		['serialization_conflict', 'transaction_conflict'].includes(output.error.code)
	)
		return 'rejected'
	return undefined
}

export const workspaceBootstrapTransaction = setup({
	schemas: {
		context: types<{ input: Input; result: Persistence | undefined }>(),
		input: types<Input>(),
		output: types<Persistence>(),
		events: { CANCEL: types(), SHUTDOWN: types() }
	},
	actors: { transaction }
}).createMachine({
	id: 'finance-workspace-bootstrap',
	context: ({ input }) => ({ input, result: undefined }),
	initial: 'transacting',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing bootstrap result')
		return context.result
	},
	states: {
		transacting: {
			on: {
				CANCEL: (_, enq) => {
					enq.sendTo('transaction', { type: 'CANCEL' })
				},
				SHUTDOWN: (_, enq) => {
					enq.sendTo('transaction', { type: 'SHUTDOWN' })
				}
			},
			invoke: {
				id: 'transaction',
				src: 'transaction',
				input: ({ context }) => ({
					attempt: {
						operationId: context.input.attempt.organizationId,
						workspaceId: context.input.attempt.organizationId,
						membershipId: context.input.attempt.membershipId,
						draft: { db: context.input.db, request: context.input.attempt }
					}
				}),
				onDone: ({ event }) => ({ target: 'completed', context: { result: result(event.output) } }),
				onError: ({ event }) => ({
					target: 'completed',
					context: {
						result: {
							outcome: 'failed',
							error: event.error,
							settlement: 'unresolved'
						}
					}
				})
			}
		},
		completed: { type: 'final' }
	}
})
