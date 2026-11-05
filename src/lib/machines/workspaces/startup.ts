import {
	assign,
	raise,
	sendTo,
	setup,
	stateIn,
	type ActorRef,
	type ActorLogic,
	type Snapshot
} from 'xstate'
import {
	sameInitializationRequest,
	type InitializationRequest,
	type InitializationRecipient,
	type InitializationStatus,
	type InitializationStatusEvent
} from '../../contracts/workspace-startup.js'
export type StartupInitializationLogic<Db, S extends Snapshot<unknown>> = ActorLogic<
	S,
	{ type: 'CANCEL' } | { type: 'SHUTDOWN' },
	{ db: Db; userId: string }
>
export type StartupSeedLogic<Db, S extends Snapshot<unknown>> = ActorLogic<
	S,
	{ type: 'CANCEL' | 'SHUTDOWN' },
	{ db: Db; userId: string; organizationId: string }
>
// Own initialization and optional application seeding independently of foreground readiness.
export function createWorkspaceStartupMachine<
	Db,
	Initialization extends { outcome: string },
	Seed,
	IS extends Snapshot<Initialization>,
	SS extends Snapshot<Seed>
>(options: {
	db: Db
	initialize: StartupInitializationLogic<Db, IS>
	seed: StartupSeedLogic<Db, SS>
	ready: (
		result: Initialization | undefined
	) => { profileId: string; organizationId: string } | undefined
	initializationFailure: (error: unknown) => Initialization
	seedFailure: (error: unknown) => Seed
}) {
	type Input = { request: InitializationRequest; recipient: InitializationRecipient }
	type Event =
		| { type: 'OBSERVED'; request: InitializationRequest }
		| { type: 'REEVALUATE' | 'SHUTDOWN' }
		| {
				type: 'DRAIN_SEED' | 'REPLACE_SEED'
				actor: ActorRef<SS, { type: 'CANCEL' | 'SHUTDOWN' }> | undefined
		  }
	type Context = Input & {
		operation: InitializationRequest | undefined
		result: WorkspaceInitializationResult | undefined
		seedResult: WorkspaceFakeDataResult | undefined
		provenance: { profileId: string; organizationId: string } | undefined
	}

	type WorkspaceInitializationResult = Initialization
	type WorkspaceFakeDataResult = Seed
	const db = options.db
	const workspaceInitialization = options.initialize
	const workspaceFakeData = options.seed

	const model = setup<
		Context,
		Event,
		{ initialize: typeof workspaceInitialization; seed: typeof workspaceFakeData },
		{},
		{},
		{
			closing: undefined
			replacing: undefined
			identityChanged: undefined
			seedAlive: undefined
			seedClosing: undefined
			seedReplacing: undefined
		},
		never,
		string,
		Input
	>({
		actors: { initialize: workspaceInitialization, seed: workspaceFakeData },
		guards: {
			closing: stateIn({ initializing: 'closing' }),
			seedClosing: stateIn({ ready: 'closing' }),
			seedReplacing: stateIn({ ready: 'replacing' }),
			seedAlive: ({ event }) =>
				(event.type === 'DRAIN_SEED' || event.type === 'REPLACE_SEED') &&
				event.actor?.getSnapshot().status === 'active',
			replacing: stateIn({ initializing: 'replacing' }),
			identityChanged: ({ context }) =>
				context.operation === undefined ||
				!sameInitializationRequest(context.request, context.operation)
		}
	})
	const report = (status: (context: Context) => InitializationStatus) =>
		model.sendTo(
			({ context }) => context.recipient,
			({ context }): InitializationStatusEvent => ({
				type: 'INITIALIZATION_STATUS',
				report: { request: context.operation ?? context.request, status: status(context) }
			})
		)
	return model.createMachine({
		id: 'workspace-startup',
		context: ({ input }) => ({
			...input,
			operation: undefined,
			result: undefined,
			seedResult: undefined,
			provenance: undefined
		}),
		initial: 'checking',
		on: {
			OBSERVED: {
				actions: [assign({ request: ({ event }) => event.request }), raise({ type: 'REEVALUATE' })]
			},
			SHUTDOWN: '.closed'
		},
		states: {
			checking: {
				always: [
					{
						guard: ({ context }) => context.request.status === 'ready' && !!context.request.userId,
						target: 'initializing'
					},
					{ target: 'waitingForSession' }
				]
			},
			waitingForSession: {
				entry: [assign({ operation: undefined }), report(() => ({ kind: 'waiting' }))],
				on: { REEVALUATE: 'checking' }
			},
			initializing: {
				initial: 'active',
				entry: [
					assign({
						operation: ({ context }) => context.request,
						result: undefined,
						seedResult: undefined,
						provenance: undefined
					}),
					report(() => ({ kind: 'checking' }))
				],
				on: {
					SHUTDOWN: { target: '.closing', actions: sendTo('initialize', { type: 'SHUTDOWN' }) },
					REEVALUATE: {
						guard: 'identityChanged',
						target: '.replacing',
						actions: sendTo('initialize', { type: 'SHUTDOWN' })
					}
				},
				states: {
					active: {},
					replacing: { entry: report(() => ({ kind: 'waiting' })), on: { REEVALUATE: {} } },
					closing: {
						entry: report(() => ({ kind: 'waiting' })),
						on: { REEVALUATE: {}, SHUTDOWN: {} }
					}
				},
				invoke: {
					id: 'initialize',
					src: 'initialize',
					input: ({ context }) => ({ db, userId: context.operation?.userId ?? '' }),
					onDone: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'checking' },
						{
							target: 'admittingReady',
							actions: assign({
								result: ({ event }) => event.output,
								provenance: ({ event }) => options.ready(event.output)
							})
						}
					],
					onError: [
						{ guard: 'closing', target: 'closed' },
						{ guard: 'replacing', target: 'checking' },
						{
							target: 'failed',
							actions: assign({
								result: ({ event }): WorkspaceInitializationResult =>
									options.initializationFailure(event.error)
							})
						}
					]
				}
			},
			admittingReady: {
				always: [
					{
						guard: ({ context }) =>
							!!context.operation?.userId &&
							!!context.provenance?.profileId &&
							!!context.provenance.organizationId,
						target: 'ready'
					},
					{ target: 'failed' }
				]
			},
			ready: {
				initial: 'seeding',
				entry: report((context) =>
					context.provenance
						? { kind: 'ready', profileId: context.provenance.profileId }
						: { kind: 'failed' }
				),
				on: {
					REEVALUATE: {
						guard: 'identityChanged',
						actions: raise(({ self }) => ({
							type: 'REPLACE_SEED',
							actor: self.getSnapshot().children.seed
						}))
					},
					SHUTDOWN: {
						actions: raise(({ self }) => ({
							type: 'DRAIN_SEED',
							actor: self.getSnapshot().children.seed
						}))
					},
					REPLACE_SEED: [
						{
							guard: 'seedAlive',
							target: '.replacing',
							actions: sendTo('seed', { type: 'SHUTDOWN' })
						},
						{ guard: 'identityChanged', target: 'checking' }
					],
					DRAIN_SEED: [
						{
							guard: 'seedAlive',
							target: '.closing',
							actions: sendTo('seed', { type: 'SHUTDOWN' })
						},
						{ target: 'closed' }
					]
				},
				states: {
					seeding: { tags: 'workspace-ready' },
					settled: { tags: 'workspace-ready' },
					replacing: { entry: report(() => ({ kind: 'waiting' })), on: { REEVALUATE: {} } },
					closing: {
						entry: report(() => ({ kind: 'waiting' })),
						on: { REEVALUATE: {}, SHUTDOWN: {} }
					}
				},
				invoke: {
					id: 'seed',
					src: 'seed',
					input: ({ context }) => ({
						db,
						userId: context.operation?.userId ?? '',
						organizationId: context.provenance?.organizationId ?? ''
					}),
					onDone: [
						{
							guard: 'seedClosing',
							target: 'closed',
							actions: assign({ seedResult: ({ event }) => event.output })
						},
						{
							guard: 'seedReplacing',
							target: 'checking',
							actions: assign({ seedResult: ({ event }) => event.output })
						},
						{
							target: '.settled',
							actions: assign({ seedResult: ({ event }) => event.output })
						}
					],
					onError: [
						{ guard: 'seedClosing', target: 'closed' },
						{ guard: 'seedReplacing', target: 'checking' },
						{
							target: '.settled',
							actions: assign({
								seedResult: ({ event }): WorkspaceFakeDataResult => options.seedFailure(event.error)
							})
						}
					]
				}
			},
			failed: {
				tags: 'workspace-error',
				entry: report(() => ({ kind: 'failed' })),
				on: { REEVALUATE: { guard: 'identityChanged', target: 'checking' } }
			},
			closed: {
				type: 'final',
				entry: report(() => ({ kind: 'closed' })),
				on: { OBSERVED: {}, SHUTDOWN: {} }
			}
		}
	})
}
