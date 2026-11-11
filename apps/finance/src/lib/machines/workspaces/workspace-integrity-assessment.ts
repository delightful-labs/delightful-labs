import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import type { schema } from 'jazz-tools'
import { app, type Organization, type OrganizationMember } from '../../schema.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type IntegrityScope = { userId: string; organizationId: string; profileId: string }
export type IntegrityRecords = {
	profiles: schema.RowOf<typeof app.profiles>[]
	organizations: Organization[]
	memberships: OrganizationMember[]
}
export type IntegrityIssue = 'profileLink'
export type IntegrityPlan = {
	profileLink: { membershipId: string; profileId: string }
}
export type IntegrityAssessment =
	| { outcome: 'complete' }
	| { outcome: 'partial'; issues: IntegrityIssue[] }
	| { outcome: 'repair'; plan: IntegrityPlan }
	| { outcome: 'unavailable'; reason: 'profileMissing' | 'accessUnavailable' }
	| {
			outcome: 'conflict'
			reason: 'profileAmbiguous' | 'membershipAmbiguous' | 'repairPlanChanged'
	  }
export type IntegrityAssessmentInput = IntegrityScope & {
	records: IntegrityRecords
}

type Context = IntegrityAssessmentInput & {
	plan: IntegrityPlan | undefined
	issues: IntegrityIssue[]
	result: IntegrityAssessment | undefined
}

function requiredPlan(plan: IntegrityPlan | undefined): IntegrityPlan {
	if (!plan) throw new Error('Missing profile-link repair plan')
	return plan
}
const events0 = { ASSESS: types<EventPayload<{ type: 'ASSESS' }, 'ASSESS'>>() }
type NativeEvent0 =
	| import('xstate').InferEvents<typeof events0>
	| import('xstate').DoneActorEvent<never>
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent

/** Current-policy adapter: never uses workspace creator/kind as authority. */
export const workspaceIntegrityAssessment = setup({
	schemas: {
		context: types<Context>(),
		events: events0,
		input: types<IntegrityAssessmentInput>(),
		output: types<IntegrityAssessment>()
	}
}).createMachine({
	id: 'workspace-integrity-assessment',
	context: ({ input }) => ({
		...input,
		plan: undefined,
		issues: [],
		result: undefined
	}),
	initial: 'checkingProfile',
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing integrity assessment')
		return context.result
	},
	states: {
		checkingProfile: {
			always: (args) => {
				const { context } = args
				if (context.records.profiles.length === 0) {
					return {
						target: 'unavailable',
						context: { result: { outcome: 'unavailable', reason: 'profileMissing' } }
					}
				}
				if (
					context.records.profiles.length !== 1 ||
					context.records.profiles[0]?.id !== context.profileId ||
					context.records.profiles[0]?.userId !== context.userId
				) {
					return {
						target: 'conflict',
						context: { result: { outcome: 'conflict', reason: 'profileAmbiguous' } }
					}
				}
				return { target: 'checkingMembership' }
			}
		},
		checkingMembership: {
			always: (args) => {
				const { context } = args
				if (
					context.records.organizations.length !== 1 ||
					context.records.organizations[0]?.id !== context.organizationId ||
					context.records.memberships.length === 0
				) {
					return {
						target: 'unavailable',
						context: { result: { outcome: 'unavailable', reason: 'accessUnavailable' } }
					}
				}
				if (
					context.records.memberships.length !== 1 ||
					context.records.memberships[0]?.userId !== context.userId ||
					context.records.memberships[0]?.organizationId !== context.organizationId
				) {
					return {
						target: 'conflict',
						context: { result: { outcome: 'conflict', reason: 'membershipAmbiguous' } }
					}
				}
				return { target: 'choosingProfileRepair' }
			}
		},
		choosingProfileRepair: {
			always: (args) => {
				const { context } = args
				if (context.records.memberships[0]?.profileId === context.profileId) {
					return { target: 'classifying' }
				}
				if (
					[ORGANIZATION_ROLE.OWNER, ORGANIZATION_ROLE.ADMIN].some(
						(role) => role === context.records.memberships[0]?.role
					)
				) {
					return {
						target: 'classifying',
						context: {
							plan: (({ context }) => {
								const membership = context.records.memberships[0]
								if (!membership) throw new Error('Missing assessed membership')
								return {
									profileLink: { membershipId: membership.id, profileId: context.profileId }
								}
							})(args)
						}
					}
				}
				return { target: 'classifying', context: { issues: ['profileLink'] } }
			}
		},
		classifying: {
			always: (args) => {
				const { context } = args
				if (context.plan !== undefined) {
					return {
						target: 'repair',
						context: {
							result: {
								outcome: 'repair',
								plan: requiredPlan(context.plan)
							}
						}
					}
				}
				if (context.issues.length > 0) {
					return {
						target: 'partial',
						context: {
							result: {
								outcome: 'partial',
								issues: context.issues
							}
						}
					}
				}
				return { target: 'complete', context: { result: { outcome: 'complete' } } }
			}
		},
		complete: { type: 'final' },
		partial: { type: 'final' },
		repair: { type: 'final' },
		unavailable: { type: 'final' },
		conflict: { type: 'final' }
	}
})
