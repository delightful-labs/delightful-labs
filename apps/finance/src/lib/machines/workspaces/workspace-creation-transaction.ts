import { ACCOUNT_ACCESS } from '#lib/domain/account-access.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import type { getDb } from 'jazz-tools/svelte'
import { app, type Organization } from '../../schema.js'
import { workspaceCreationAttemptSchema } from '../../validation/identity.js'
import type { WorkspaceCreationAttempt } from '../../domain/workspace-creation.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type WorkspacePersistenceEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type WorkspacePersistenceResult =
	| { outcome: 'succeeded'; settlement: 'locallyPersisted'; workspace: Organization }
	| { outcome: 'profileUnavailable' | 'conflict'; settlement: 'notStarted' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }

type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
type Input = { db: Db; attempt: WorkspaceCreationAttempt; purpose?: 'additional' | 'bootstrap' }
type Event = WorkspacePersistenceEvent

// Boundary narrowing only; workflow eligibility is decided by guarded states below.
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing workspace transaction resource')
	return value
}

const open = createAsyncLogic({
	run: ({ input }: { input: Db }) => Promise.resolve(input.beginTransaction())
})
const read = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; attempt: WorkspaceCreationAttempt } }) => {
		const { tx, attempt } = input
		const [profile, organization, membership, categories] = await Promise.all([
			tx.one(app.profiles.where({ id: attempt.profileId, userId: attempt.workspace.ownerId })),
			tx.one(app.organizations.where({ id: attempt.organizationId })),
			tx.one(app.organizationMembers.where({ id: attempt.membershipId })),
			tx.all(app.categories.where({ organizationId: attempt.organizationId }))
		])
		return { profile, organization, membership, categories }
	}
})
const insert = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; attempt: WorkspaceCreationAttempt } }) => {
		const { tx, attempt } = input
		const workspace = tx.insert(app.organizations, attempt.workspace, {
			id: attempt.organizationId
		})
		tx.insert(
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
		for (const { id, ...category } of attempt.categories) {
			tx.insert(app.categories, { organizationId: attempt.organizationId, ...category }, { id })
		}
		return workspace
	}
})
const createProfile = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; attempt: WorkspaceCreationAttempt } }) =>
		input.tx.insert(
			app.profiles,
			{
				userId: input.attempt.workspace.ownerId,
				initialWorkspaceId: input.attempt.organizationId
			},
			{ id: input.attempt.profileId }
		)
})
const commit = createAsyncLogic({
	run: ({ input }: { input: Transaction }) => Promise.resolve(input.commit())
})
const settle = createAsyncLogic({
	run: ({ input }: { input: OutputFrom<typeof commit> }) => input.wait({ tier: 'local' })
})
const rollback = createAsyncLogic({ run: ({ input }: { input: Transaction }) => input.rollback() })
const events0 = {
	CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof open>
			| import('xstate').OutputFrom<typeof read>
			| import('xstate').OutputFrom<typeof insert>
			| import('xstate').OutputFrom<typeof createProfile>
			| import('xstate').OutputFrom<typeof commit>
			| import('xstate').OutputFrom<typeof settle>
			| import('xstate').OutputFrom<typeof rollback>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

type Context = {
	request: Input
	tx: Transaction | undefined
	records: OutputFrom<typeof read> | undefined
	workspace: Organization | undefined
	write: OutputFrom<typeof commit> | undefined
	result: WorkspacePersistenceResult | undefined
}

/** Owns one open Jazz transaction across guarded checks, staging, commit and cleanup. */
export const workspaceCreationTransaction = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<WorkspacePersistenceResult>(),
		children: {
			open: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						insert: typeof insert
						createProfile: typeof createProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['open']
				>
			>(),
			read: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						insert: typeof insert
						createProfile: typeof createProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['read']
				>
			>(),
			insert: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						insert: typeof insert
						createProfile: typeof createProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['insert']
				>
			>(),
			createProfile: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						insert: typeof insert
						createProfile: typeof createProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['createProfile']
				>
			>(),
			commit: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						insert: typeof insert
						createProfile: typeof createProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['commit']
				>
			>(),
			settle: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						insert: typeof insert
						createProfile: typeof createProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['settle']
				>
			>(),
			rollback: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						insert: typeof insert
						createProfile: typeof createProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['rollback']
				>
			>()
		}
	},
	actors: { open, read, insert, createProfile, commit, settle, rollback },
	guards: {
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, args.value),
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'cancelling' } }, args.value)
	}
}).createMachine({
	id: 'workspace-creation-transaction',
	context: ({ input }) => ({
		request: input,
		tx: undefined,
		records: undefined,
		workspace: undefined,
		write: undefined,
		result: undefined
	}),
	initial: 'running',
	output: ({ context }) => required(context.result),
	states: {
		running: {
			type: 'parallel',
			states: {
				control: {
					initial: 'active',
					states: {
						active: {
							on: {
								CANCEL: { target: 'cancelling' },
								SHUTDOWN: { target: 'closing' }
							}
						},
						cancelling: {
							on: {
								CANCEL: {},
								SHUTDOWN: { target: 'closing' }
							}
						},
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.request.db,
								onDone: (args) => {
									return { target: 'checkingAfterOpen', context: { tx: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						checkingAfterOpen: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								return { target: 'reading' }
							}
						},
						reading: {
							invoke: {
								src: 'read',
								input: ({ context }) => ({
									tx: required(context.tx),
									attempt: context.request.attempt
								}),
								onDone: (args) => {
									return { target: 'checkingProfile', context: { records: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						checkingProfile: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (context.records?.profile != null && context.request.purpose !== 'bootstrap') {
									return { target: 'checkingAttempt' }
								}
								if (context.records?.profile == null && context.request.purpose === 'bootstrap') {
									return { target: 'checkingAttempt' }
								}
								return {
									target: 'rollingBack',
									context: {
										result: {
											outcome: 'profileUnavailable',
											settlement: 'notStarted'
										}
									}
								}
							}
						},
						checkingAttempt: {
							always: (args) => {
								const { context } = args
								if (
									context.records?.organization == null &&
									context.records?.membership == null &&
									context.records?.categories.length === 0
								) {
									return { target: 'choosingStaging' }
								}
								return {
									target: 'rollingBack',
									context: {
										result: {
											outcome: 'conflict',
											settlement: 'notStarted'
										}
									}
								}
							}
						},
						choosingStaging: {
							always: (args) => {
								if (args.context.request.purpose === 'bootstrap') {
									return { target: 'creatingProfile' }
								}
								return { target: 'staging' }
							}
						},
						creatingProfile: {
							invoke: {
								src: 'createProfile',
								input: ({ context }) => ({
									tx: required(context.tx),
									attempt: context.request.attempt
								}),
								onDone: { target: 'checkingAfterProfile' },
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						checkingAfterProfile: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								return { target: 'staging' }
							}
						},
						staging: {
							invoke: {
								src: 'insert',
								input: ({ context }) => ({
									tx: required(context.tx),
									attempt: workspaceCreationAttemptSchema.parse(context.request.attempt)
								}),
								onDone: (args) => {
									return {
										target: 'checkingBeforeCommit',
										context: { workspace: args.event.output }
									}
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'notStarted',
												error: args.event.error
											}
										}
									}
								}
							}
						},
						checkingBeforeCommit: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								return { target: 'committing' }
							}
						},
						committing: {
							invoke: {
								src: 'commit',
								input: ({ context }) => required(context.tx),
								onDone: (args) => {
									return { target: 'settling', context: { write: args.event.output } }
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
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
						settling: {
							invoke: {
								src: 'settle',
								input: ({ context }) => required(context.write),
								onDone: (args) => {
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'succeeded',
												settlement: 'locallyPersisted',
												workspace: required(args.context.workspace)
											}
										}
									}
								},
								onError: (args) => {
									return {
										target: 'rollingBack',
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
						rollingBack: {
							invoke: {
								src: 'rollback',
								input: ({ context }) => required(context.tx),
								onDone: (args) => {
									if (args.event.output) {
										return { target: 'finishing' }
									}
									return {
										target: 'finishing',
										context: {
											result: {
												outcome: 'failed',
												settlement: 'unresolved',
												error: new Error('Workspace transaction rollback was not confirmed')
											}
										}
									}
								},
								onError: (args) => {
									return {
										target: 'finishing',
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
						finishing: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: '#workspace-creation-transaction.closed' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: '#workspace-creation-transaction.cancelled' }
								}
								return { target: '#workspace-creation-transaction.completed' }
							}
						}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: {
							outcome: 'closed',
							settlement: args.context.result?.settlement ?? 'notStarted'
						}
					}
				}
			}
		},
		cancelled: {
			type: 'final',
			entry: (args) => {
				return {
					context: {
						result: {
							outcome: 'cancelled',
							settlement: args.context.result?.settlement ?? 'notStarted'
						}
					}
				}
			}
		},
		completed: { type: 'final' }
	}
})
