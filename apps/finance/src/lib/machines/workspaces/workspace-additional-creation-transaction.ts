import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type {
	WorkspaceCreationAttempt as SharedAttempt,
	WorkspaceCreationResult,
	DetachedTransaction
} from 'delightful-local-first/workspace/creation/contracts'
import { ACCOUNT_ACCESS } from '../../domain/account-access.js'
import { ORGANIZATION_ROLE } from '../../domain/organization-role.js'
import { app, type Organization } from '../../schema.js'
import type { WorkspaceCreationAttempt } from '../../domain/workspace-creation.js'
import { workspaceCreationAttemptSchema } from '../../validation/identity.js'
import type {
	WorkspacePersistenceEvent,
	WorkspacePersistenceResult
} from './workspace-creation-transaction.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
type Attempt = SharedAttempt<WorkspaceCreationAttempt>
// Keep uncertain native receipts with their database lifetime; never roll back an issued commit
// or replay a detached write. The existing creation journal remains the recovery evidence.
const detached = new WeakMap<
	object,
	Set<DetachedTransaction<Transaction, ReturnType<Transaction['commit']>>>
>()

/** One related snapshot from the same mergeable transaction, with no remote preflight. */
async function readLocal(transaction: Transaction, { draft: attempt }: Attempt) {
	const options = { tier: ReadTier.LocalFirst }
	const [profile, organization, membership, categories] = await Promise.all([
		transaction.one(
			app.profiles.where({ id: attempt.profileId, userId: attempt.workspace.ownerId }),
			options
		),
		transaction.one(app.organizations.where({ id: attempt.organizationId }), options),
		transaction.one(app.organizationMembers.where({ id: attempt.membershipId }), options),
		transaction.all(app.categories.where({ organizationId: attempt.organizationId }), options)
	])
	return { profile, organization, membership, categories }
}

/** Unconditional staging only. The shared statechart has already assessed snapshot eligibility. */
function stage(transaction: Transaction, { draft }: Attempt) {
	const attempt = workspaceCreationAttemptSchema.parse(draft)
	const workspace = transaction.insert(app.organizations, attempt.workspace, {
		id: attempt.organizationId
	})
	transaction.insert(
		app.organizationMembers,
		{
			organizationId: attempt.organizationId,
			userId: attempt.workspace.ownerId,
			profileId: attempt.profileId,
			role: ORGANIZATION_ROLE.OWNER,
			accountAccessMode: ACCOUNT_ACCESS.ALL
		},
		{ id: attempt.membershipId }
	)
	for (const { id, ...category } of attempt.categories)
		transaction.insert(
			app.categories,
			{ organizationId: attempt.organizationId, ...category },
			{ id }
		)
	return workspace
}

function domainResult(
	result: WorkspaceCreationResult<WorkspaceCreationAttempt, Organization>
): WorkspacePersistenceResult {
	if (result.outcome === 'succeeded')
		return {
			outcome: 'succeeded',
			settlement: 'locallyPersisted',
			workspace: result.settlement.workspace
		}
	if (result.outcome === 'blocked')
		return {
			outcome: result.reason === 'profileUnavailable' ? 'profileUnavailable' : 'conflict',
			settlement: 'notStarted'
		}
	if (result.outcome === 'failed')
		return { outcome: 'failed', settlement: result.settlement.kind, error: result.error }
	return { outcome: result.outcome, settlement: result.settlement.kind }
}

/** Bind once per creation owner. Finance retains schemas/journals; the library owns resource lifetime. */
export function createAdditionalWorkspaceTransaction(db: Db) {
	const transaction = createWorkspaceCreationTransaction<
		WorkspaceCreationAttempt,
		Transaction,
		Awaited<ReturnType<typeof readLocal>>,
		Organization,
		Awaited<ReturnType<Transaction['commit']>>
	>({
		open: () => db.beginTransaction(),
		retainDetached: (receipt) => {
			const retained = detached.get(db) ?? new Set()
			retained.add(receipt)
			detached.set(db, retained)
		},
		readLocal,
		assess: (records) => {
			if (!records.profile) return { outcome: 'blocked', reason: 'profileUnavailable' }
			if (records.organization || records.membership || records.categories.length > 0)
				return { outcome: 'blocked', reason: 'conflict' }
			return { outcome: 'eligible' }
		},
		stage,
		commit: (resource) => resource.commit(),
		persistLocal: async (write) => {
			await write.wait({ tier: 'local' })
		},
		rollback: (resource) => resource.rollback()
	})
	const events0 = {
		CANCEL: types<EventPayload<WorkspacePersistenceEvent, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<WorkspacePersistenceEvent, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof transaction>>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<{
				attempt: WorkspaceCreationAttempt
				result: WorkspacePersistenceResult | undefined
			}>(),
			events: events0,
			input: types<{ attempt: WorkspaceCreationAttempt }>(),
			output: types<WorkspacePersistenceResult>(),
			children: {
				transaction:
					types<import('xstate').ActorRefFrom<{ transaction: typeof transaction }['transaction']>>()
			}
		},
		actors: { transaction }
	}).createMachine({
		id: 'finance-additional-workspace-transaction',
		initial: 'transacting',
		context: ({ input }) => ({ attempt: input.attempt, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing additional workspace result')
			return context.result
		},
		states: {
			transacting: {
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('transaction', { type: 'CANCEL' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('transaction', { type: 'SHUTDOWN' })
					}
				},
				invoke: {
					id: 'transaction',
					src: 'transaction',
					input: ({ context }) => ({
						attempt: {
							operationId: context.attempt.organizationId,
							workspaceId: context.attempt.organizationId,
							membershipId: context.attempt.membershipId,
							draft: context.attempt
						}
					}),
					onDone: (args) => {
						return { target: 'completed', context: { result: domainResult(args.event.output) } }
					},
					onError: (args) => {
						return {
							target: 'completed',
							context: {
								result: {
									outcome: 'failed',
									settlement: 'unresolved',
									error: args.event.error
								}
							}
						}
					}
				}
			},
			completed: { type: 'final' }
		}
	})
}
