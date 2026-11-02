import { assign, fromPromise, raise, sendParent, sendTo, setup, stateIn } from 'xstate'
import { restorationMachine } from './restoration.js'
import type { RestorationCapability, RestorationReport } from '../../contracts/restoration.js'
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing recovery resource')
	return value
}

export type RecoverySession = {
	getSnapshot: () => { status: string; account?: { id: string } | undefined }
}
type Session = RecoverySession
export type RecoveryRestorationBinding = Readonly<{
	binding: object
	capability: RestorationCapability
	invalidate: () => void
}>
export type RecoveryNavigation = { origin: string; destination: string; identity: string }
export type RecoveryRequest =
	| { kind: 'restore'; phrase: string; origin: string; destination: string }
	| ({ kind: 'navigate' } & RecoveryNavigation)
export type RecoveryResult =
	| {
			outcome: 'invalid' | 'restoreFailed' | 'restored' | 'closed'
			mutation: 'notStarted' | 'settled'
	  }
	| {
			outcome: 'navigationFailed'
			mutation: 'notStarted' | 'settled'
			navigation: RecoveryNavigation | undefined
	  }
export type RecoveryNotice =
	| { type: 'RECOVERY_VALIDATED'; attempt: number }
	| { type: 'RECOVERY_DRAIN_REQUESTED'; attempt: number }
type Input = {
	attempt: number
	request: RecoveryRequest
	session: Session
	restorationBinding: RecoveryRestorationBinding | undefined
	readHref: () => string
	navigate: (destination: string) => Promise<void>
}
type Context = {
	attempt: number
	request: RecoveryRequest | undefined
	session: Session
	restorationBinding: RecoveryRestorationBinding | undefined
	readHref: () => string
	navigate: Input['navigate']
	origin: string
	destination: string
	identity: string | undefined
	mutation: 'notStarted' | 'settled'
	result: RecoveryResult | undefined
}
type Event =
	| RestorationReport
	| { type: 'WORKSPACE_DRAINED' }
	| { type: 'SHUTDOWN' }
	| { type: 'RELEASE_REQUEST' }

const actors = {
	restoration: restorationMachine,
	navigationFacts: fromPromise(
		async ({ input }: { input: { session: Session; readHref: () => string } }) => {
			const snapshot = input.session.getSnapshot()
			return { status: snapshot.status, identity: snapshot.account?.id, href: input.readHref() }
		}
	),
	navigate: fromPromise(
		({ input }: { input: { navigate: Input['navigate']; destination: string } }) =>
			input.navigate(input.destination)
	)
}
const model = setup<
	Context,
	Event,
	typeof actors,
	{},
	{ releaseBinding: undefined; navigationFailed: undefined },
	{ closingRestore: undefined; closingNavigation: undefined; currentReport: undefined },
	never,
	string,
	Input,
	RecoveryResult
>({
	actors,
	guards: {
		closingRestore: stateIn({ restoring: 'closing' }),
		closingNavigation: stateIn({ navigating: 'closing' }),
		currentReport: ({ context, event }) =>
			(event.type === 'RESTORATION_VALIDATED' || event.type === 'RESTORATION_PREPARE_REQUESTED') &&
			event.binding === context.restorationBinding?.binding &&
			event.attempt === context.attempt
	},
	actions: {
		releaseBinding: ({ context }) => context.restorationBinding?.invalidate(),
		navigationFailed: assign({
			result: ({ context }): RecoveryResult => ({
				outcome: 'navigationFailed',
				mutation: context.mutation,
				navigation: context.identity
					? { identity: context.identity, origin: context.origin, destination: context.destination }
					: undefined
			})
		})
	}
})
const finish = (outcome: 'invalid' | 'restoreFailed' | 'restored' | 'closed') =>
	model.createStateConfig({
		type: 'final',
		entry: assign({
			result: ({ context }): RecoveryResult => ({ outcome, mutation: context.mutation }),
			request: undefined
		})
	})

/** Restoration lifetime coordinated with host-owned drain and navigation capabilities. */
export const sessionRecoveryMachine = model.createMachine({
	id: 'session-recovery',
	initial: 'choosing',
	context: ({ input }) => ({
		attempt: input.attempt,
		request: input.request,
		session: input.session,
		restorationBinding: input.restorationBinding,
		readHref: input.readHref,
		navigate: input.navigate,
		origin: input.request.origin,
		destination: input.request.destination,
		identity: input.request.kind === 'navigate' ? input.request.identity : undefined,
		mutation: 'notStarted',
		result: undefined
	}),
	output: ({ context }) => required(context.result),
	on: { SHUTDOWN: '.closed' },
	states: {
		choosing: {
			always: [
				{
					guard: ({ context }) => context.request?.kind === 'navigate',
					target: 'checkingNavigation',
					actions: assign({ request: undefined })
				},
				{ target: 'restoring' }
			]
		},
		restoring: {
			initial: 'validating',
			entry: raise({ type: 'RELEASE_REQUEST' }),
			exit: ['releaseBinding', assign({ restorationBinding: undefined })],
			invoke: {
				id: 'restoration',
				src: 'restoration',
				input: ({ context, self }) => {
					const request = required(context.request)
					if (request.kind !== 'restore') throw new Error('Missing recovery input')
					const binding = required(context.restorationBinding)
					return {
						scope: { binding: binding.binding, attempt: context.attempt },
						capability: binding.capability,
						phrase: request.phrase,
						reportTo: self
					}
				},
				onDone: [
					{
						guard: 'closingRestore',
						target: 'closed',
						actions: assign({ mutation: ({ event }) => event.output.mutation })
					},
					{ guard: ({ event }) => event.output.outcome === 'invalid', target: 'invalid' },
					{
						guard: ({ event }) => event.output.outcome === 'cancelled',
						target: 'closed',
						actions: assign({ mutation: ({ event }) => event.output.mutation })
					},
					{
						guard: ({ event }) => event.output.outcome === 'restored',
						target: 'checkingNavigation',
						actions: assign({
							mutation: ({ event }) => event.output.mutation,
							identity: ({ event }) =>
								event.output.outcome === 'restored' ? event.output.identityId : undefined
						})
					},
					{
						guard: ({ event }) => event.output.outcome === 'identityUnavailable',
						target: 'navigationFailed',
						actions: [
							assign({ mutation: ({ event }) => event.output.mutation }),
							'navigationFailed'
						]
					},
					{
						target: 'restoreFailed',
						actions: assign({ mutation: ({ event }) => event.output.mutation })
					}
				],
				// Unexpected child crashes remain application failures, not a fabricated settled result.
				onError: {
					actions: () => {
						throw new Error('Restoration child failed')
					}
				}
			},
			on: {
				RELEASE_REQUEST: { actions: assign({ request: undefined }) },
				SHUTDOWN: { target: '.closing', actions: sendTo('restoration', { type: 'SHUTDOWN' }) }
			},
			states: {
				validating: {
					on: {
						RESTORATION_VALIDATED: {
							guard: 'currentReport',
							actions: sendParent(({ context }): RecoveryNotice => ({
								type: 'RECOVERY_VALIDATED',
								attempt: context.attempt
							}))
						},
						RESTORATION_PREPARE_REQUESTED: {
							guard: 'currentReport',
							target: 'awaitingDrain',
							actions: sendParent(({ context }): RecoveryNotice => ({
								type: 'RECOVERY_DRAIN_REQUESTED',
								attempt: context.attempt
							}))
						}
					}
				},
				awaitingDrain: {
					on: {
						WORKSPACE_DRAINED: {
							target: 'operating',
							actions: sendTo('restoration', ({ context }) => ({
								type: 'PREPARED',
								binding: required(context.restorationBinding).binding,
								attempt: context.attempt
							}))
						}
					}
				},
				operating: {},
				closing: { on: { SHUTDOWN: {} } }
			}
		},
		checkingNavigation: {
			invoke: {
				src: 'navigationFacts',
				input: ({ context }) => ({ session: context.session, readHref: context.readHref }),
				onDone: [
					{
						guard: ({ context, event }) =>
							event.output.status === 'ready' &&
							event.output.identity === context.identity &&
							event.output.href === context.origin,
						target: 'navigating'
					},
					{ target: 'restored' }
				],
				onError: { target: 'navigationFailed', actions: 'navigationFailed' }
			}
		},
		navigating: {
			initial: 'active',
			invoke: {
				src: 'navigate',
				input: ({ context }) => ({ navigate: context.navigate, destination: context.destination }),
				onDone: [{ guard: 'closingNavigation', target: 'closed' }, { target: 'restored' }],
				onError: [
					{ guard: 'closingNavigation', target: 'closed' },
					{ target: 'navigationFailed', actions: 'navigationFailed' }
				]
			},
			on: { SHUTDOWN: '.closing' },
			states: { active: {}, closing: { on: { SHUTDOWN: {} } } }
		},
		invalid: finish('invalid'),
		restoreFailed: finish('restoreFailed'),
		restored: finish('restored'),
		closed: finish('closed'),
		navigationFailed: { type: 'final', entry: assign({ request: undefined }) }
	}
})
