import { ACCOUNT_KIND } from '#lib/domain/account-kind.js'
import { stableUuid } from '#lib/data.js'
import { appAccountSchema } from '#lib/validation/accounts.js'
import { createAccountWriteMachine } from './account-write.js'
import { required } from './identity.js'
import type { MappingInterruption } from './account-write-transaction.js'
import type { Dependencies, OperationWork, ProviderSummary, Result } from './types.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = { work: OperationWork; provider: ProviderSummary }
type Context = Input & {
	values: ReturnType<typeof appAccountSchema.parse> | undefined
	accountId: string | undefined
	error: unknown
}

export function createAccountCreationMachine(dependencies: Dependencies) {
	const actors = {
		validate: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				Promise.resolve(
					appAccountSchema.parse({
						organizationId: input.work.scope.organizationId,
						name: input.provider.name,
						kind: ACCOUNT_KIND.BANK,
						currency: input.provider.currency
					})
				)
		}),
		accountId: createAsyncLogic({
			run: ({ input }: { input: Input }) =>
				stableUuid(input.work.scope.organizationId, `simplefin-account:${input.provider.id}`)
		}),
		write: createAccountWriteMachine(dependencies)
	}
	const events0 = {
		CREATE: types<EventPayload<{ type: 'CREATE' } | MappingInterruption, 'CREATE'>>(),
		CANCEL: types<EventPayload<{ type: 'CREATE' } | MappingInterruption, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<{ type: 'CREATE' } | MappingInterruption, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['validate']>
				| import('xstate').OutputFrom<(typeof actors)['accountId']>
				| import('xstate').OutputFrom<(typeof actors)['write']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Result<undefined>>(),
			children: {
				validate: types<import('xstate').ActorRefFrom<(typeof actors)['validate']>>(),
				accountId: types<import('xstate').ActorRefFrom<(typeof actors)['accountId']>>(),
				write: types<import('xstate').ActorRefFrom<(typeof actors)['write']>>()
			}
		},
		actors
	}).createMachine({
		id: 'bank-account-create',
		context: ({ input }) => ({
			...input,
			values: undefined,
			accountId: undefined,
			error: undefined
		}),
		initial: 'validatingAccount',
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
			validatingAccount: {
				invoke: {
					src: 'validate',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'generatingAccountId', context: { values: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			generatingAccountId: {
				invoke: {
					src: 'accountId',
					input: ({ context }) => context,
					onDone: (args) => {
						return { target: 'writingAccountAndLink', context: { accountId: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			writingAccountAndLink: {
				on: {
					CANCEL: (args, enq) => {
						{
							const child = args.children.write
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'CANCEL' })
						}
					},
					SHUTDOWN: (args, enq) => {
						{
							const child = args.children.write
							if (child?.getSnapshot().status === 'active') enq.sendTo(child, { type: 'SHUTDOWN' })
						}
					}
				},
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }) => ({
						kind: 'create',
						work: context.work,
						provider: context.provider,
						accountId: required(context.accountId),
						values: required(context.values)
					}),
					onDone: (args) => {
						const { event } = args
						if (!event.output.ok) {
							return {
								target: 'failed',
								context: { error: event.output.ok ? undefined : event.output.error }
							}
						}
						return { target: 'complete' }
					},
					onError: (args) => {
						return { target: 'failed', context: { error: args.event.error } }
					}
				}
			},
			complete: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
