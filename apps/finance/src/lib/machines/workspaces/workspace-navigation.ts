import { ReadTier } from 'jazz-tools'
import type { getDb } from 'jazz-tools/svelte'
import { app } from '../../schema.js'
import {
	switchedWorkspaceHref,
	workspaceHref,
	workspaceRoute
} from '../../domain/workspace-routes.js'

import type {
	WorkspaceNavigationFacts,
	NavigationRecipient,
	NavigationStatus,
	NavigationStatusEvent,
	WorkspaceNavigate
} from '../../contracts/workspace-orchestration-contract.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type { WorkspaceNavigationFacts } from '../../contracts/workspace-orchestration-contract.js'
type Input = { facts: WorkspaceNavigationFacts; recipient: NavigationRecipient }
type Context = Input & {
	resolving: WorkspaceNavigationFacts | undefined
	emptyEntry: WorkspaceNavigationFacts | undefined
	destination: string | undefined
	replace: boolean
	transaction: { organizationId: string } | null
	preferredWorkspaceId: string | null
}
function defaultWorkspaceHref(context: Context, workspaceId: string | null) {
	const route =
		context.facts.pathname === '/settings/workspace'
			? (context.emptyEntry ?? context.facts)
			: context.facts
	return workspaceHref(workspaceId, `${route.pathname}${route.search}${route.hash}`)
}
type Event =
	| { type: 'OBSERVED'; facts: WorkspaceNavigationFacts }
	| { type: 'SELECT'; workspaceId: string }
	| { type: 'REEVALUATE' | 'RETRY' | 'SHUTDOWN' }
export function createWorkspaceNavigationMachine(
	db: Pick<ReturnType<typeof getDb>, 'one'>,
	navigate: WorkspaceNavigate
) {
	const actors = {
		profile: createAsyncLogic({
			run: ({ input }: { input: string }) =>
				db.one(app.profiles.where({ userId: input }), { tier: ReadTier.LocalFirst })
		}),
		lookup: createAsyncLogic({
			run: ({ input }: { input: string }) => db.one(app.transactions.where({ id: input }))
		}),
		navigate: createAsyncLogic({
			run: ({
				input,
				signal
			}: {
				input: { destination: string; expectedHref: string; replace: boolean }
				signal: AbortSignal
			}) => navigate(input.destination, signal, input.expectedHref, input.replace)
		})
	}
	const events0 = {
		OBSERVED: types<EventPayload<Event, 'OBSERVED'>>(),
		SELECT: types<EventPayload<Event, 'SELECT'>>(),
		REEVALUATE: types<EventPayload<Event, 'REEVALUATE'>>(),
		RETRY: types<EventPayload<Event, 'RETRY'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['profile']>
				| import('xstate').OutputFrom<(typeof actors)['lookup']>
				| import('xstate').OutputFrom<(typeof actors)['navigate']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			children: {
				profile: types<import('xstate').ActorRefFrom<(typeof actors)['profile']>>(),
				lookup: types<import('xstate').ActorRefFrom<(typeof actors)['lookup']>>(),
				navigate: types<import('xstate').ActorRefFrom<(typeof actors)['navigate']>>()
			}
		},
		actors
	})
	return model.createMachine({
		id: 'workspace-navigation',
		context: ({ input }) => ({
			...input,
			resolving: undefined,
			emptyEntry: undefined,
			destination: undefined,
			replace: true,
			transaction: null,
			preferredWorkspaceId: null
		}),
		initial: 'assessing',
		on: {
			SHUTDOWN: { target: '.closed' },
			SELECT: (args) => {
				const { context } = args
				return {
					target: '.navigating',
					context: {
						emptyEntry: undefined,
						replace: false,
						destination: switchedWorkspaceHref(
							args.event.workspaceId,
							context.facts.pathname,
							context.facts.search,
							context.facts.hash
						)
					}
				}
			},
			OBSERVED: (args, enq) => {
				const { event } = args
				enq.raise({ type: 'REEVALUATE' })
				return {
					context: {
						emptyEntry: (({ context, event }) => {
							const origin = context.emptyEntry
							const facts = event.facts
							if (
								!origin ||
								!facts.ready ||
								facts.userId !== origin.userId ||
								workspaceRoute(facts.search).scoped ||
								(facts.pathname !== '/settings/workspace' &&
									`${facts.pathname}${facts.search}${facts.hash}` !==
										`${origin.pathname}${origin.search}${origin.hash}`)
							)
								return undefined
							return origin
						})(args),
						facts: event.facts
					}
				}
			},
			REEVALUATE: { target: '.assessing' },
			RETRY: { target: '.assessing' }
		},
		states: {
			assessing: {
				entry: () => {
					return { context: { replace: true } }
				},
				always: (args) => {
					const { context } = args
					if (!context.facts.ready) {
						return { target: 'waiting' }
					}
					if (
						context.facts.pathname === '/settings/workspace' &&
						(workspaceRoute(context.facts.search).scoped ||
							context.facts.loading ||
							context.facts.error != null ||
							context.facts.organizations.length === 0)
					)
						return { target: 'directory' }

					if (['/account', '/login'].includes(context.facts.pathname)) {
						return { target: 'global' }
					}
					if (context.facts.loading) {
						return { target: 'waiting' }
					}
					if (context.facts.error != null) {
						return { target: 'failed' }
					}
					if (workspaceRoute(context.facts.search).scoped) {
						return { target: 'checkingScope' }
					}
					if (/^\/(expenses|income)\/(?!new$)[^/]+$/.test(context.facts.pathname)) {
						return { target: 'resolvingLegacy' }
					}
					if (context.facts.organizations.length === 1)
						return {
							target: 'navigating',
							context: {
								destination: defaultWorkspaceHref(
									context,
									context.facts.organizations[0]?.id ?? null
								),
								emptyEntry: undefined
							}
						}
					if (context.facts.organizations.length > 1) return { target: 'resolvingDefault' }
					return {
						target: 'navigating',
						context: { emptyEntry: context.facts, destination: '/settings/workspace' }
					}
				}
			},
			resolvingDefault: {
				entry: ({ context }, enq) => {
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'waiting' }
					})
					return { context: { resolving: context.facts } }
				},
				on: {
					REEVALUATE: ({ context }, enq) => {
						if (
							context.facts.pathname !== context.resolving?.pathname ||
							context.facts.search !== context.resolving?.search ||
							context.facts.hash !== context.resolving?.hash ||
							context.facts.userId !== context.resolving?.userId ||
							!context.facts.ready ||
							context.facts.loading ||
							context.facts.error != null
						)
							return { target: 'assessing' }
						enq.sendTo(context.recipient, {
							type: 'NAVIGATION_STATUS',
							report: { generation: context.facts.generation, status: 'waiting' }
						})
						return {}
					}
				},
				invoke: model.createInvoke({
					id: 'profile',
					src: actors.profile,
					input: ({ context }) => {
						if (!context.facts.userId) throw new Error('Missing workspace identity')
						return context.facts.userId
					},
					onDone: ({ event }) => ({
						target: 'choosingDefault',
						context: { preferredWorkspaceId: event.output?.initialWorkspaceId ?? null }
					}),
					onError: { target: 'failed' }
				})
			},
			choosingDefault: {
				always: ({ context }) => {
					const preferred = context.facts.organizations.some(
						(row) => row.id === context.preferredWorkspaceId
					)
					if (preferred || context.facts.organizations.length > 0)
						return {
							target: 'navigating',
							context: {
								destination: defaultWorkspaceHref(
									context,
									preferred
										? context.preferredWorkspaceId
										: (context.facts.organizations.map((row) => row.id).sort()[0] ?? null)
								),
								emptyEntry: undefined
							}
						}
					return { target: 'assessing' }
				}
			},

			checkingScope: {
				always: (args) => {
					const { context } = args
					if (context.facts.access === 'waiting') {
						return { target: 'waiting' }
					}
					if (context.facts.access === 'failed') {
						return { target: 'failed' }
					}
					if (context.facts.access === 'ready') {
						return { target: 'scoped' }
					}
					return { target: 'unavailable' }
				}
			},
			resolvingLegacy: {
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({ resolving: (({ context }) => context.facts)(args) }))(args)
					}
					context = { ...args.context, ...patch }
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'waiting' }
					})
					return { context: patch }
				},
				on: {
					REEVALUATE: (args, enq) => {
						const { context } = args
						if (
							context.facts.pathname !== context.resolving?.pathname ||
							context.facts.search !== context.resolving?.search ||
							context.facts.hash !== context.resolving?.hash ||
							context.facts.userId !== context.resolving?.userId ||
							!context.facts.ready
						) {
							return { target: 'assessing' }
						}
						enq.sendTo(context.recipient, {
							type: 'NAVIGATION_STATUS',
							report: { generation: context.facts.generation, status: 'waiting' }
						})
						return {}
					}
				},
				invoke: {
					src: 'lookup',
					input: ({ context }) => context.facts.pathname.split('/').at(-1) ?? '',
					onDone: (args) => {
						return { target: 'checkingLegacy', context: { transaction: args.event.output } }
					},
					onError: { target: 'failed' }
				}
			},
			checkingLegacy: {
				always: (args) => {
					const { context } = args
					if (
						context.transaction != null &&
						context.facts.organizations.some(
							(row) => row.id === context.transaction?.organizationId
						)
					) {
						return {
							target: 'navigating',
							context: {
								destination: workspaceHref(
									context.transaction?.organizationId ?? null,
									`${context.facts.pathname}${context.facts.search}${context.facts.hash}`
								)
							}
						}
					}
					return { target: 'unavailable' }
				}
			},
			navigating: {
				entry: (args, enq) => {
					let context = args.context
					let patch = {}
					patch = {
						...patch,
						...((args) => ({ resolving: (({ context }) => context.facts)(args) }))(args)
					}
					context = { ...args.context, ...patch }
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'waiting' }
					})
					return { context: patch }
				},
				on: {
					REEVALUATE: (args, enq) => {
						const { context } = args
						if (
							context.facts.userId !== context.resolving?.userId ||
							!context.facts.ready ||
							(`${context.facts.pathname}${context.facts.search}${context.facts.hash}` !==
								`${context.resolving?.pathname}${context.resolving?.search}${context.resolving?.hash}` &&
								`${context.facts.pathname}${context.facts.search}${context.facts.hash}` !==
									context.destination)
						) {
							return { target: 'assessing' }
						}
						enq.sendTo(context.recipient, {
							type: 'NAVIGATION_STATUS',
							report: { generation: context.facts.generation, status: 'waiting' }
						})
						return {}
					}
				},
				invoke: {
					src: 'navigate',
					input: ({ context }) => {
						if (!context.destination) throw new Error('Missing navigation destination')
						return {
							destination: context.destination,
							expectedHref: `${context.facts.pathname}${context.facts.search}${context.facts.hash}`,
							replace: context.replace
						}
					},
					onDone: (args) => {
						const { context } = args
						if (
							context.destination ===
							`${context.facts.pathname}${context.facts.search}${context.facts.hash}`
						) {
							return { target: 'assessing' }
						}
						return { target: 'settled' }
					},
					onError: { target: 'failed' }
				}
			},
			waiting: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'waiting' }
					})
				}
			},
			directory: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'directory' }
					})
				}
			},
			global: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'global' }
					})
				}
			},
			scoped: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'scoped' }
					})
				}
			},
			settled: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'waiting' }
					})
				}
			},
			closed: { type: 'final' },
			unavailable: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'unavailable' }
					})
				}
			},
			failed: {
				entry: (args, enq) => {
					const { context } = args
					enq.sendTo(context.recipient, {
						type: 'NAVIGATION_STATUS',
						report: { generation: context.facts.generation, status: 'failed' }
					})
				}
			}
		}
	})
}
