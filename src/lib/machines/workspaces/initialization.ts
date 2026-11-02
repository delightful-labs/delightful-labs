import { assign, fromPromise, sendTo, setup, type ActorLogic, type Snapshot } from 'xstate'
export type InitializationEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type InitializationRecords = {
	profiles: readonly { id: string; initialWorkspaceId?: string | null | undefined }[]
	organizations: readonly unknown[]
	serverConfigured: boolean
}
export type InitializationOutcome<Persistence> =
	| Persistence
	| { outcome: 'ready'; profileId: string; organizationId: string }
	| {
			outcome: 'unavailable'
			reason:
				| 'authorityUnavailable'
				| 'initializationMissing'
				| 'profileMissing'
				| 'duplicateProfiles'
	  }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| { outcome: 'closed' | 'cancelled'; settlement: 'notStarted' }
export type BootstrapLogic<Db, Attempt, S extends Snapshot<unknown>> = ActorLogic<
	S,
	InitializationEvent,
	{ db: Db; attempt: Attempt; purpose?: 'additional' | 'bootstrap' }
>
export function createWorkspaceInitialization<
	Db,
	Tier,
	Attempt extends { profileId: string; organizationId: string },
	Persistence extends { outcome: string },
	S extends Snapshot<Persistence>
>(options: {
	tiers: { local: Tier; authority: Tier }
	discover: (input: { db: Db; userId: string; tier: Tier }) => Promise<InitializationRecords>
	prepareInitial: (input: { db: Db; userId: string }) => Promise<Attempt>
	transaction: BootstrapLogic<Db, Attempt, S>
}) {
	type Input = { db: Db; userId: string }
	type Records = InitializationRecords
	type WorkspaceCreationAttempt = Attempt
	type WorkspacePersistenceEvent = InitializationEvent
	type WorkspaceInitializationResult = InitializationOutcome<Persistence>
	const discover = fromPromise(async ({ input }: { input: Input & { tier: Tier } }) =>
		options.discover(input)
	)
	const prepareInitial = fromPromise(async ({ input }: { input: Input }) =>
		options.prepareInitial(input)
	)
	type Context = Input & {
		records: Records | undefined
		attempt: WorkspaceCreationAttempt | undefined
		result: WorkspaceInitializationResult | undefined
	}
	function required<T>(value: T | undefined): T {
		if (value === undefined) throw new Error('Missing workspace initialization observation')
		return value
	}

	/** Initialization provenance is independent of the active workspace/route. No writes on empty cache alone. */
	const machine = setup<
		Context,
		WorkspacePersistenceEvent,
		{
			discover: typeof discover
			prepareInitial: typeof prepareInitial
			transaction: typeof options.transaction
		},
		{},
		{},
		{},
		never,
		string,
		Input,
		WorkspaceInitializationResult
	>({
		actors: {
			discover,
			prepareInitial,
			transaction: options.transaction
		}
	}).createMachine({
		id: 'workspace-initialization',
		context: ({ input }) => ({
			...input,
			records: undefined,
			attempt: undefined,
			result: undefined
		}),
		initial: 'readingLocal',
		output: ({ context }) => required(context.result),
		on: {
			CANCEL: { target: '.cancelled' },
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			readingLocal: {
				invoke: {
					src: 'discover',
					input: ({ context }) => ({
						db: context.db,
						userId: context.userId,
						tier: options.tiers.local
					}),
					onDone: {
						target: 'checkingProfiles',
						actions: assign({ records: ({ event }) => event.output })
					},
					onError: {
						target: 'failed',
						actions: assign({
							result: ({ event }): WorkspaceInitializationResult => ({
								outcome: 'failed',
								settlement: 'notStarted',
								error: event.error
							})
						})
					}
				}
			},
			checkingProfiles: {
				always: [
					{
						guard: ({ context }) => (context.records?.profiles.length ?? 0) > 1,
						target: 'duplicateProfiles'
					},
					{ target: 'checkingInitialization' }
				]
			},
			checkingInitialization: {
				always: [
					{
						guard: ({ context }) => context.records?.profiles[0]?.initialWorkspaceId != null,
						target: 'ready'
					},
					{ target: 'checkingAuthority' }
				]
			},
			checkingAuthority: {
				always: [
					{
						guard: ({ context }) => context.records?.serverConfigured === true,
						target: 'awaitingAuthority'
					},
					{ target: 'authorityUnavailable' }
				]
			},
			awaitingAuthority: {
				// Remote waits offline; no timeout or empty local result authorizes bootstrap.
				invoke: {
					src: 'discover',
					input: ({ context }) => ({
						db: context.db,
						userId: context.userId,
						tier: options.tiers.authority
					}),
					onDone: {
						target: 'checkingAuthoritativeProfiles',
						actions: assign({ records: ({ event }) => event.output })
					},
					onError: {
						target: 'failed',
						actions: assign({
							result: ({ event }): WorkspaceInitializationResult => ({
								outcome: 'failed',
								settlement: 'notStarted',
								error: event.error
							})
						})
					}
				}
			},
			checkingAuthoritativeProfiles: {
				always: [
					{
						guard: ({ context }) => (context.records?.profiles.length ?? 0) > 1,
						target: 'duplicateProfiles'
					},
					{
						guard: ({ context }) => context.records?.profiles[0]?.initialWorkspaceId != null,
						target: 'ready'
					},
					{
						guard: ({ context }) => context.records?.profiles.length === 1,
						target: 'initializationMissing'
					},
					{
						guard: ({ context }) => (context.records?.organizations.length ?? 0) > 0,
						target: 'profileMissing'
					},
					{ target: 'preparingInitial' }
				]
			},
			preparingInitial: {
				invoke: {
					src: 'prepareInitial',
					input: ({ context }) => context,
					onDone: {
						target: 'bootstrapping',
						actions: assign({ attempt: ({ event }) => event.output })
					},
					onError: {
						target: 'failed',
						actions: assign({
							result: ({ event }): WorkspaceInitializationResult => ({
								outcome: 'failed',
								settlement: 'notStarted',
								error: event.error
							})
						})
					}
				}
			},
			bootstrapping: {
				on: {
					CANCEL: { actions: sendTo('bootstrap', { type: 'CANCEL' }) },
					SHUTDOWN: { actions: sendTo('bootstrap', { type: 'SHUTDOWN' }) }
				},
				invoke: {
					id: 'bootstrap',
					src: 'transaction',
					input: ({ context }) => ({
						db: context.db,
						attempt: required(context.attempt),
						purpose: 'bootstrap'
					}),
					onDone: [
						{
							guard: ({ event }) => event.output?.outcome === 'succeeded',
							target: 'ready'
						},
						{ target: 'completed', actions: assign({ result: ({ event }) => event.output }) }
					],
					onError: {
						target: 'failed',
						actions: assign({
							result: ({ event }): WorkspaceInitializationResult => ({
								outcome: 'failed',
								settlement: 'unresolved',
								error: event.error
							})
						})
					}
				}
			},
			ready: {
				type: 'final',
				entry: assign({
					result: ({ context }): WorkspaceInitializationResult => ({
						outcome: 'ready',
						profileId: context.attempt?.profileId ?? required(context.records?.profiles[0]).id,
						organizationId:
							context.attempt?.organizationId ??
							required(required(context.records?.profiles[0]).initialWorkspaceId ?? undefined)
					})
				})
			},
			duplicateProfiles: {
				type: 'final',
				entry: assign({
					result: (): WorkspaceInitializationResult => ({
						outcome: 'unavailable',
						reason: 'duplicateProfiles'
					})
				})
			},
			profileMissing: {
				type: 'final',
				entry: assign({
					result: (): WorkspaceInitializationResult => ({
						outcome: 'unavailable',
						reason: 'profileMissing'
					})
				})
			},
			authorityUnavailable: {
				type: 'final',
				entry: assign({
					result: (): WorkspaceInitializationResult => ({
						outcome: 'unavailable',
						reason: 'authorityUnavailable'
					})
				})
			},
			initializationMissing: {
				type: 'final',
				entry: assign({
					result: (): WorkspaceInitializationResult => ({
						outcome: 'unavailable',
						reason: 'initializationMissing'
					})
				})
			},
			cancelled: {
				type: 'final',
				entry: assign({
					result: (): WorkspaceInitializationResult => ({
						outcome: 'cancelled',
						settlement: 'notStarted'
					})
				})
			},
			closed: {
				type: 'final',
				entry: assign({
					result: (): WorkspaceInitializationResult => ({
						outcome: 'closed',
						settlement: 'notStarted'
					})
				})
			},
			failed: { type: 'final' },
			completed: { type: 'final' }
		}
	})

	return machine
}
