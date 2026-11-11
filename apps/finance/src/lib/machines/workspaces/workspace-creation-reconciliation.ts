import { ACCOUNT_ACCESS } from '#lib/domain/account-access.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Organization } from '../../schema.js'
import type { WorkspaceCreationAttempt } from '../../domain/workspace-creation.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = {
	db: Pick<ReturnType<typeof getDb>, 'all'>
	attempt: WorkspaceCreationAttempt
}
export type ReconciliationResult =
	| { outcome: 'absent' | 'conflict' | 'profileUnavailable' }
	| { outcome: 'matching'; workspace: Organization }
const read = createAsyncLogic({
	run: async ({ input }: { input: Input }) => {
		const { db, attempt } = input
		const options = { tier: ReadTier.LocalFirst }
		const [profiles, organizations, memberships, categories] = await Promise.all([
			db.all(
				app.profiles.where({ id: attempt.profileId, userId: attempt.workspace.ownerId }),
				options
			),
			db.all(app.organizations.where({ id: attempt.organizationId }), options),
			db.all(
				app.organizationMembers.where({
					organizationId: attempt.organizationId,
					userId: attempt.workspace.ownerId
				}),
				options
			),
			db.all(app.categories.where({ organizationId: attempt.organizationId }), options)
		])
		return { profiles, organizations, memberships, categories }
	}
})
type Context = Input & {
	records: import('xstate').OutputFrom<typeof read> | undefined
	result: ReconciliationResult | undefined
}
const events0 = { CHECK: types<EventPayload<{ type: 'CHECK' }, 'CHECK'>>() }
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof read>>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent
export const workspaceCreationReconciliation = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<ReconciliationResult>(),
		children: { read: types<import('xstate').ActorRefFrom<{ read: typeof read }['read']>>() }
	},
	actors: { read }
}).createMachine({
	initial: 'reading',
	context: ({ input }) => ({ ...input, records: undefined, result: undefined }),
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing reconciliation result')
		return context.result
	},
	states: {
		reading: {
			invoke: {
				src: 'read',
				input: ({ context }) => context,
				onDone: (args) => {
					return { target: 'checkingProfile', context: { records: args.event.output } }
				}
			}
		},
		checkingProfile: {
			always: (args) => {
				const { context } = args
				if (
					context.records?.profiles.length === 1 &&
					context.records.profiles[0]?.id === context.attempt.profileId &&
					context.records.profiles[0]?.userId === context.attempt.workspace.ownerId
				) {
					return { target: 'checkingRecords' }
				}
				return {
					target: 'profileUnavailable',
					context: { result: { outcome: 'profileUnavailable' } }
				}
			}
		},
		checkingRecords: {
			always: (args) => {
				const { context } = args
				if (
					context.records?.organizations.length === 0 &&
					context.records.memberships.length === 0 &&
					context.records.categories.length === 0
				) {
					return { target: 'absent', context: { result: { outcome: 'absent' } } }
				}
				if (
					(({ context }) => {
						const rows = context.records
						const attempt = context.attempt
						const organization = rows?.organizations[0]
						const member = rows?.memberships[0]
						return (
							rows?.organizations.length === 1 &&
							rows.memberships.length === 1 &&
							organization?.id === attempt.organizationId &&
							organization.ownerId === attempt.workspace.ownerId &&
							organization.defaultCurrency === attempt.workspace.defaultCurrency &&
							member?.id === attempt.membershipId &&
							member.organizationId === attempt.organizationId &&
							member.userId === attempt.workspace.ownerId &&
							member.profileId === attempt.profileId &&
							member.role === ORGANIZATION_ROLE.OWNER &&
							member.accountAccessMode === ACCOUNT_ACCESS.ALL &&
							attempt.categories
								.filter((row) => row.isSystem)
								.every((expected) =>
									rows.categories.some(
										(row) =>
											row.organizationId === attempt.organizationId &&
											row.id === expected.id &&
											row.kind === expected.kind &&
											row.isSystem &&
											row.archivedAt == null
									)
								) &&
							rows.categories.every(
								(row) =>
									attempt.categories.some(
										(expected) =>
											expected.id === row.id &&
											expected.kind === row.kind &&
											expected.isSystem === row.isSystem
									) || !row.isSystem
							)
						)
					})(args)
				) {
					return {
						target: 'matching',
						context: {
							result: (({ context }): ReconciliationResult => {
								const workspace = context.records?.organizations[0]
								if (!workspace) throw new Error('Missing matched workspace')
								return { outcome: 'matching', workspace }
							})(args)
						}
					}
				}
				return { target: 'conflict', context: { result: { outcome: 'conflict' } } }
			}
		},
		absent: { type: 'final' },
		matching: { type: 'final' },
		conflict: { type: 'final' },
		profileUnavailable: { type: 'final' }
	}
})
