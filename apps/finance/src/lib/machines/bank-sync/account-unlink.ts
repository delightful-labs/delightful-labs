import type { schema } from 'jazz-tools'
import { app } from '#lib/schema.js'
import { createAuthorizationMachine } from './authorization.js'
import { required } from './identity.js'
import type { MappingInterruption } from './account-write-transaction.js'
import {
	credentialAuthorization,
	type Dependencies,
	type OperationWork,
	type Result
} from './types.js'
import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Link = schema.RowOf<typeof app.simplefinAccountLinks>
type Input = { work: OperationWork; providerId: string }
type Context = Input & { links: Link[]; index: number; error: unknown }

export function createAccountUnlinkMachine(dependencies: Dependencies) {
	const { db } = dependencies
	const actors = {
		links: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				db.all(
					app.simplefinAccountLinks.where({
						organizationId: input.work.scope.organizationId,
						simplefinAccountId: input.providerId
					})
				)
		}),
		authorize: createAuthorizationMachine(dependencies),
		remove: createAsyncLogic<void, Link>({
			run: async ({ input, signal }) => {
				signal.throwIfAborted()
				await db.delete(app.simplefinAccountLinks, input.id).wait({ tier: 'local' })
			}
		})
	}
	const events0 = {
		UNLINK: types<EventPayload<{ type: 'UNLINK' } | MappingInterruption, 'UNLINK'>>(),
		CANCEL: types<EventPayload<{ type: 'UNLINK' } | MappingInterruption, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<{ type: 'UNLINK' } | MappingInterruption, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['links']>
				| import('xstate').OutputFrom<(typeof actors)['authorize']>
				| import('xstate').OutputFrom<(typeof actors)['remove']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Result<undefined>>(),
			children: {
				links: types<import('xstate').ActorRefFrom<(typeof actors)['links']>>(),
				authorize: types<import('xstate').ActorRefFrom<(typeof actors)['authorize']>>(),
				remove: types<import('xstate').ActorRefFrom<(typeof actors)['remove']>>()
			}
		},
		actors,
		guards: {}
	}).createMachine({
		id: 'bank-account-unlink',
		context: ({ input }) => ({ ...input, links: [], index: 0, error: undefined }),
		initial: 'loadingLinks',
		on: {
			CANCEL: () => {
				return { target: '.failed', context: { error: new Error('disconnected') } }
			},
			SHUTDOWN: () => {
				return { target: '.failed', context: { error: new Error('disconnected') } }
			}
		},
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			loadingLinks: {
				invoke: {
					src: 'links',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'choosingLink', context: { links: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			choosingLink: {
				always: (args) => {
					const { context } = args
					if (context.index >= context.links.length) {
						return { target: 'complete' }
					}
					return { target: 'authorizingRemoval' }
				}
			},
			authorizingRemoval: {
				invoke: {
					src: 'authorize',
					input: ({ context }) => credentialAuthorization(context.work),
					onDone: (args) => {
						const { event } = args
						if (event.output.error !== undefined) {
							return { target: 'failed', context: { error: event.output.error } }
						}
						return { target: 'removingLink' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			removingLink: {
				initial: 'working',
				states: {
					working: {},
					draining: { on: { CANCEL: {}, SHUTDOWN: {} } }
				},
				on: {
					CANCEL: () => {
						return { target: '.draining', context: { error: new Error('disconnected') } }
					},
					SHUTDOWN: () => {
						return { target: '.draining', context: { error: new Error('disconnected') } }
					}
				},
				invoke: {
					src: 'remove',
					input: ({ context }) => required(context.links[context.index]),
					onDone: (args) => {
						if (matchesState({ removingLink: 'draining' }, args.value)) {
							return { target: 'failed' }
						}
						return { target: 'choosingLink', context: { index: args.context.index + 1 } }
					},
					onError: (args) => {
						if (matchesState({ removingLink: 'draining' }, args.value)) {
							return { target: 'failed' }
						}
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			complete: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
