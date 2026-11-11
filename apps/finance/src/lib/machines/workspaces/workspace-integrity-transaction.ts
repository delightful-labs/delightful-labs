import type { getDb } from 'jazz-tools/svelte'
import { app } from '../../schema.js'
import {
	workspaceIntegrityAssessment,
	type IntegrityAssessment,
	type IntegrityAssessmentInput,
	type IntegrityPlan,
	type IntegrityRecords
} from './workspace-integrity-assessment.js'
import { createJazzTransactionActors } from '../persistence/jazz-transaction-actors.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { OutputFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type IntegrityEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type IntegrityResult =
	| (Exclude<IntegrityAssessment, { outcome: 'repair' }> & {
			settlement: 'notStarted' | 'locallyPersisted'
	  })
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }
type Db = Pick<ReturnType<typeof getDb>, 'beginTransaction'>
type Transaction = ReturnType<Db['beginTransaction']>
type Input = Omit<IntegrityAssessmentInput, 'records'> & { db: Db; expected: IntegrityPlan }

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing integrity transaction resource')
	return value
}
const transactionActors = createJazzTransactionActors(
	(db: Db) => db.beginTransaction(),
	(write: ReturnType<Transaction['commit']>) => write.wait({ tier: 'local' })
)
const { open, commit, settle, rollback } = transactionActors
const read = createAsyncLogic({
	run: async ({
		input
	}: {
		input: { tx: Transaction; scope: Input }
	}): Promise<IntegrityRecords> => {
		const { tx, scope } = input
		const [profiles, organizations, memberships] = await Promise.all([
			tx.all(app.profiles.where({ userId: scope.userId })),
			tx.all(app.organizations.where({ id: scope.organizationId })),
			tx.all(
				app.organizationMembers.where({
					organizationId: scope.organizationId,
					userId: scope.userId
				})
			)
		])
		return { profiles, organizations, memberships }
	}
})
const linkProfile = createAsyncLogic({
	run: async ({ input }: { input: { tx: Transaction; link: IntegrityPlan['profileLink'] } }) =>
		input.tx.update(app.organizationMembers, input.link.membershipId, {
			profileId: input.link.profileId
		})
})
type Context = Input & {
	tx: Transaction | undefined
	records: IntegrityRecords | undefined
	assessment: IntegrityAssessment | undefined
	plan: IntegrityPlan | undefined
	write: OutputFrom<typeof commit> | undefined
	result: IntegrityResult | undefined
}
const events0 = {
	CANCEL: types<EventPayload<IntegrityEvent, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<IntegrityEvent, 'SHUTDOWN'>>()
}
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<typeof open>
			| import('xstate').OutputFrom<typeof read>
			| import('xstate').OutputFrom<typeof workspaceIntegrityAssessment>
			| import('xstate').OutputFrom<typeof linkProfile>
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

/** One resource owner: reads/checks/staging/commit are states, never a transaction callback. */
export const workspaceIntegrityTransaction = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<Input>(),
		output: types<IntegrityResult>(),
		children: {
			open: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						assess: typeof workspaceIntegrityAssessment
						linkProfile: typeof linkProfile
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
						assess: typeof workspaceIntegrityAssessment
						linkProfile: typeof linkProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['read']
				>
			>(),
			assess: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						assess: typeof workspaceIntegrityAssessment
						linkProfile: typeof linkProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['assess']
				>
			>(),
			linkProfile: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						assess: typeof workspaceIntegrityAssessment
						linkProfile: typeof linkProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['linkProfile']
				>
			>(),
			commit: types<
				import('xstate').ActorRefFrom<
					{
						open: typeof open
						read: typeof read
						assess: typeof workspaceIntegrityAssessment
						linkProfile: typeof linkProfile
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
						assess: typeof workspaceIntegrityAssessment
						linkProfile: typeof linkProfile
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
						assess: typeof workspaceIntegrityAssessment
						linkProfile: typeof linkProfile
						commit: typeof commit
						settle: typeof settle
						rollback: typeof rollback
					}['rollback']
				>
			>()
		}
	},
	actors: {
		open,
		read,
		assess: workspaceIntegrityAssessment,
		linkProfile,
		commit,
		settle,
		rollback
	},
	guards: {
		closing: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, args.value),
		cancelling: (args: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'cancelling' } }, args.value)
	}
}).createMachine({
	id: 'workspace-integrity-transaction',
	context: ({ input }) => ({
		...input,
		tx: undefined,
		records: undefined,
		assessment: undefined,
		plan: undefined,
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
						active: { on: { CANCEL: { target: 'cancelling' }, SHUTDOWN: { target: 'closing' } } },
						cancelling: { on: { CANCEL: {}, SHUTDOWN: { target: 'closing' } } },
						closing: { on: { CANCEL: {}, SHUTDOWN: {} } }
					}
				},
				work: {
					initial: 'opening',
					states: {
						opening: {
							invoke: {
								src: 'open',
								input: ({ context }) => context.db,
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
								input: ({ context }) => ({ tx: required(context.tx), scope: context }),
								onDone: (args) => {
									return { target: 'checkingAfterRead', context: { records: args.event.output } }
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
						checkingAfterRead: {
							always: (args) => {
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								return { target: 'assessing' }
							}
						},
						assessing: {
							invoke: {
								src: 'assess',
								input: ({ context }) => ({ ...context, records: required(context.records) }),
								onDone: (args) => {
									return { target: 'checkingPlan', context: { assessment: args.event.output } }
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
						checkingPlan: {
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: 'rollingBack' }
								}
								if (context.assessment !== undefined && context.assessment.outcome !== 'repair') {
									return {
										target: 'rollingBack',
										context: {
											result: (({ context }): IntegrityResult => {
												const assessment = required(context.assessment)
												if (assessment.outcome === 'repair')
													throw new Error('Expected terminal assessment')
												return { ...assessment, settlement: 'notStarted' }
											})(args)
										}
									}
								}
								if (
									context.assessment?.outcome === 'repair' &&
									context.assessment.plan.profileLink.membershipId ===
										context.expected.profileLink.membershipId &&
									context.assessment.plan.profileLink.profileId ===
										context.expected.profileLink.profileId
								) {
									return {
										target: 'stagingProfileLink',
										context: (({ context }) => {
											const assessment = required(context.assessment)
											if (assessment.outcome !== 'repair')
												throw new Error('Expected repair payload')
											return { plan: assessment.plan }
										})(args)
									}
								}
								return {
									target: 'rollingBack',
									context: {
										result: {
											outcome: 'conflict',
											reason: 'repairPlanChanged',
											settlement: 'notStarted'
										}
									}
								}
							}
						},
						stagingProfileLink: {
							invoke: {
								src: 'linkProfile',
								input: ({ context }) => ({
									tx: required(context.tx),
									link: required(context.plan?.profileLink)
								}),
								onDone: { target: 'checkingBeforeCommit' },
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
								onDone: { target: 'classifyingSuccess' },
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
						classifyingSuccess: {
							always: () => {
								return {
									target: 'finishing',
									context: { result: { outcome: 'complete', settlement: 'locallyPersisted' } }
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
												error: new Error('Integrity rollback was not confirmed')
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
							entry: () => {
								return {
									context: { tx: undefined, write: undefined, records: undefined, plan: undefined }
								}
							},
							always: (args) => {
								const { context } = args
								if (matchesState({ running: { control: 'closing' } }, args.value)) {
									return { target: '#workspace-integrity-transaction.closed' }
								}
								if (matchesState({ running: { control: 'cancelling' } }, args.value)) {
									return { target: '#workspace-integrity-transaction.cancelled' }
								}
								if (context.result?.outcome === 'complete') {
									return { target: '#workspace-integrity-transaction.complete' }
								}
								if (context.result?.outcome === 'partial') {
									return { target: '#workspace-integrity-transaction.partial' }
								}
								if (context.result?.outcome === 'unavailable') {
									return { target: '#workspace-integrity-transaction.unavailable' }
								}
								if (context.result?.outcome === 'conflict') {
									return { target: '#workspace-integrity-transaction.conflict' }
								}
								if (context.result?.settlement === 'unresolved') {
									return { target: '#workspace-integrity-transaction.unresolved' }
								}
								return { target: '#workspace-integrity-transaction.failed' }
							}
						}
					}
				}
			}
		},
		complete: { type: 'final' },
		partial: { type: 'final' },
		unavailable: { type: 'final' },
		conflict: { type: 'final' },
		failed: { type: 'final' },
		unresolved: { type: 'final' },
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
		}
	}
})
