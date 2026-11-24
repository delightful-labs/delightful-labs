import { workerWorkspaceSeed } from '../workspaces/workspace-fake-data.js'
import {
	createWorkspaceCreationMachine,
	selectWorkspaceCreationReport
} from '../workspaces/workspace-creation.js'
import { type workerWorkspaceCreationCommand } from '../../contracts/worker-forms.js'
import type { z } from 'zod'
import type { ProfileObservation } from '../../contracts/profile-contract.js'
import { workerProfileFormView, type WorkerProfileForms } from '../../contracts/worker-forms.js'
import type { NavigationReport } from '../../contracts/workspace-orchestration-contract.js'
import {
	setup,
	types,
	matchesState,
	type SnapshotFrom,
	type InputFrom,
	type OutputFrom
} from 'xstate'
import { workspaceInitialization } from '../workspaces/workspace-initialization.js'
import { createWorkspaceStartupOwner } from 'delightful-local-first/workspace/startup'
import type { WorkspaceInitializationReport } from 'delightful-local-first/workspace/startup-contracts'
import {
	createScopedFormMachine,
	selectScopedFormView,
	selectScopedFormObservation
} from '../forms/scoped-form.js'
import {
	type WorkerFormCommand,
	type FinanceFormsObservation
} from '../../contracts/worker-forms.js'
import type { FinanceIdentityDependencies } from './worker-form-dependencies.js'

type InitializationResult = OutputFrom<typeof workspaceInitialization>
const workspaceStartup = createWorkspaceStartupOwner<
	InputFrom<typeof workspaceInitialization>,
	InitializationResult,
	SnapshotFrom<typeof workspaceInitialization>
>({
	initialize: workspaceInitialization,
	provenance: (result) =>
		result.outcome === 'ready'
			? { identityId: result.identityId, initialWorkspaceId: result.workspaceId }
			: undefined
})

type Input = {
	observation: Pick<FinanceFormsObservation, 'profile' | 'navigation'>
	selectionRevision: number
}
type Context = Input & {
	workspaceCreation: ReturnType<typeof selectWorkspaceCreationReport> | undefined
	profileName: WorkerProfileForms['name'] | undefined
	profileNameObservation: ProfileObservation | undefined
	profileAvatar: WorkerProfileForms['avatar'] | undefined
	profileAvatarObservation: ProfileObservation | undefined
	navigation: NavigationReport | undefined
	seedClosed: boolean
	initialization: InitializationResult | undefined
}
export function createFinanceIdentityControlsMachine(dependencies: FinanceIdentityDependencies) {
	const workspaceCreation = createWorkspaceCreationMachine(dependencies.db)
	const profileName = createScopedFormMachine(dependencies.profile.name)
	const profileAvatar = createScopedFormMachine(dependencies.profile.avatar)
	function creationBinding(observation: Input['observation']) {
		const profile = observation.profile
		return profile.sessionReady &&
			profile.binding === dependencies.binding &&
			profile.identityId &&
			profile.profile?.id &&
			profile.profile.userId === profile.identityId
			? { key: dependencies.creationKey, userId: profile.identityId, profileId: profile.profile.id }
			: undefined
	}
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' }>(),
			internalEvents: {
				WORKSPACE_CREATION_CLOSED: types(),
				PROFILE_NAME_CLOSED: types(),
				PROFILE_AVATAR_CLOSED: types(),
				NAVIGATION_CLOSED: types(),
				SEED_CLOSED: types(),
				INITIALIZATION_CLOSED: types()
			},
			events: {
				WORKSPACE_INITIALIZATION_RESULT:
					types<Omit<WorkspaceInitializationReport<InitializationResult>, 'type'>>(),
				OBSERVE: types<Input>(),
				NAVIGATION_STATUS: types<{ report: NavigationReport }>(),
				SELECT_WORKSPACE: types<{ workspaceId: string }>(),
				NAVIGATE: types<{ destination: string; replace: boolean }>(),
				RETRY_NAVIGATION: types(),
				WORKSPACE_CREATION: types<{ command: z.output<typeof workerWorkspaceCreationCommand> }>(),
				PROFILE: types<{ form: 'name' | 'avatar'; command: WorkerFormCommand }>(),
				SHUTDOWN: types()
			},
			children: {
				workspaceCreation: types<import('xstate').ActorRefFrom<typeof workspaceCreation>>(),
				profileName: types<import('xstate').ActorRefFrom<typeof profileName>>(),
				profileAvatar: types<import('xstate').ActorRefFrom<typeof profileAvatar>>(),
				navigation: types<import('xstate').ActorRefFrom<typeof dependencies.navigation>>(),
				seed: types<import('xstate').ActorRefFrom<typeof workerWorkspaceSeed>>(),
				initialization: types<import('xstate').ActorRefFrom<typeof workspaceStartup>>()
			}
		},
		actors: {
			workspaceCreation,
			profileName,
			profileAvatar,
			navigation: dependencies.navigation,
			seed: workerWorkspaceSeed,
			workspaceStartup
		}
	}).createMachine({
		id: 'finance-identity-controls',
		initial: 'active',
		context: ({ input }) => ({
			...input,
			workspaceCreation: undefined,
			profileName: undefined,
			profileNameObservation: undefined,
			profileAvatar: undefined,
			profileAvatarObservation: undefined,
			navigation: undefined,
			seedClosed: false,
			initialization: undefined
		}),
		output: () => ({ outcome: 'closed' }),
		invoke: [
			{
				id: 'workspaceCreation',
				src: 'workspaceCreation',
				input: ({ context }) => ({ binding: creationBinding(context.observation) }),
				onSnapshot: ({ event }) => ({
					context: { workspaceCreation: selectWorkspaceCreationReport(event.snapshot) }
				}),
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'WORKSPACE_CREATION_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'profileName',
				src: 'profileName',
				input: ({ context }) => context.observation.profile,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.profile) return
					const view = workerProfileFormView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.profile.name)
					)
					return view.success
						? {
								context: {
									profileName: view.data,
									profileNameObservation: context.observation.profile
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'PROFILE_NAME_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'profileAvatar',
				src: 'profileAvatar',
				input: ({ context }) => context.observation.profile,
				onSnapshot: ({ context, event }) => {
					if (selectScopedFormObservation(event.snapshot) !== context.observation.profile) return
					const view = workerProfileFormView.safeParse(
						selectScopedFormView(event.snapshot, dependencies.profile.avatar)
					)
					return view.success
						? {
								context: {
									profileAvatar: view.data,
									profileAvatarObservation: context.observation.profile
								}
							}
						: { target: '.failed' }
				},
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'PROFILE_AVATAR_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'navigation',
				src: 'navigation',
				input: ({ context, self }) => ({ facts: context.observation.navigation, recipient: self }),
				onDone: ({ value }, enq) => {
					if (!matchesState('closing', value)) return { target: '.failed' }
					enq.raise({ type: 'NAVIGATION_CLOSED' })
				},
				onError: { target: '.failed' }
			},
			{
				id: 'seed',
				src: 'seed',
				input: () => ({ db: dependencies.db, userId: dependencies.initialization.userId }),
				onDone: ({ event, value }, enq) => {
					if (event.output.outcome !== 'closed') return { target: '.failed' }
					if (matchesState('closing', value)) enq.raise({ type: 'SEED_CLOSED' })
					return { context: { seedClosed: true } }
				},
				onError: { target: '.failed' }
			},
			{
				id: 'initialization',
				src: 'workspaceStartup',
				input: ({ self }) => ({
					binding: dependencies.binding,
					initialization: dependencies.initialization,
					recipient: self
				}),
				onDone: ({ value, event }, enq) => {
					if (!matchesState('closing', value) || event.output.outcome !== 'closed')
						return { target: '.failed' }
					enq.raise({ type: 'INITIALIZATION_CLOSED' })
					return { context: { initialization: event.output.initialization } }
				},
				onError: { target: '.failed' }
			}
		],
		states: {
			active: {
				on: {
					NAVIGATION_STATUS: ({ context, event }) =>
						event.report.generation === context.observation.navigation.generation
							? { context: { navigation: event.report } }
							: undefined,
					SELECT_WORKSPACE: ({ event }, enq) =>
						enq.sendTo('navigation', { type: 'SELECT', workspaceId: event.workspaceId }),
					NAVIGATE: ({ event }, enq) => enq.sendTo('navigation', event),
					RETRY_NAVIGATION: (_, enq) => enq.sendTo('navigation', { type: 'RETRY' }),
					WORKSPACE_CREATION: ({ event }, enq) => enq.sendTo('workspaceCreation', event.command),
					PROFILE: ({ event }, enq) =>
						enq.sendTo(event.form === 'name' ? 'profileName' : 'profileAvatar', event.command),
					WORKSPACE_INITIALIZATION_RESULT: ({ event }, enq) => {
						if (event.binding !== dependencies.binding) return
						if (event.provenance)
							enq.sendTo('seed', {
								type: 'INITIALIZED',
								workspaceId: event.provenance.initialWorkspaceId
							})
						return { context: { initialization: event.initialization } }
					},
					OBSERVE: ({ event }, enq) => {
						enq.sendTo('workspaceCreation', {
							type: 'OBSERVED',
							binding: creationBinding(event.observation)
						})
						enq.sendTo('profileName', { type: 'OBSERVE', observation: event.observation.profile })
						enq.sendTo('profileAvatar', { type: 'OBSERVE', observation: event.observation.profile })
						enq.sendTo('navigation', { type: 'OBSERVED', facts: event.observation.navigation })
						return {
							context: {
								observation: event.observation,
								selectionRevision: event.selectionRevision
							}
						}
					},
					SHUTDOWN: ({ self }, enq) => {
						const seed = self.getSnapshot().children.seed
						if (seed?.getSnapshot().status === 'active') enq.sendTo(seed, { type: 'SHUTDOWN' })
						enq.sendTo('initialization', { type: 'SHUTDOWN' })
						enq.sendTo('workspaceCreation', { type: 'SHUTDOWN' })
						enq.sendTo('profileName', { type: 'SHUTDOWN' })
						enq.sendTo('profileAvatar', { type: 'SHUTDOWN' })
						enq.sendTo('navigation', { type: 'SHUTDOWN' })
						return { target: 'closing' }
					}
				}
			},
			closing: {
				type: 'parallel',
				on: { SHUTDOWN: {}, NAVIGATION_STATUS: {} },
				onDone: { target: 'closed' },
				states: {
					profileName: {
						initial: 'waiting',
						states: {
							waiting: { on: { PROFILE_NAME_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					profileAvatar: {
						initial: 'waiting',
						states: {
							waiting: { on: { PROFILE_AVATAR_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					workspaceCreation: {
						initial: 'waiting',
						states: {
							waiting: { on: { WORKSPACE_CREATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					navigation: {
						initial: 'waiting',
						states: {
							waiting: { on: { NAVIGATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					seed: {
						initial: 'assessing',
						states: {
							assessing: {
								type: 'choice',
								choice: ({ context }) => ({ target: context.seedClosed ? 'closed' : 'waiting' })
							},
							waiting: { on: { SEED_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					},
					initialization: {
						initial: 'waiting',
						states: {
							waiting: { on: { INITIALIZATION_CLOSED: { target: 'closed' } } },
							closed: { type: 'final' }
						}
					}
				}
			},
			failed: { on: { SHUTDOWN: {} } },
			closed: { type: 'final' }
		}
	})
}
/** Public identity facts; lifecycle remains owned by the identity statechart. */
export function selectFinanceIdentityControls(
	snapshot: SnapshotFrom<ReturnType<typeof createFinanceIdentityControlsMachine>>
) {
	const c = snapshot.context
	return {
		status:
			snapshot.status === 'done' && snapshot.matches('closed')
				? 'closed'
				: snapshot.status !== 'active' || snapshot.matches('failed')
					? 'failed'
					: snapshot.matches('closing')
						? 'closing'
						: 'active',
		workspaceCreation: c.workspaceCreation,
		profileName: c.profileName,
		profileNameObservation: c.profileNameObservation,
		profileAvatar: c.profileAvatar,
		profileAvatarObservation: c.profileAvatarObservation,
		navigation: c.navigation,
		initialization: c.initialization
	}
}
