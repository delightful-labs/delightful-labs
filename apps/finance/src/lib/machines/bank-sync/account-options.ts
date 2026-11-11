import type { Account } from '#lib/schema.js'
import type { ProviderSummary } from './types.js'
import { required } from './identity.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = {
	provider: ProviderSummary
	accounts: readonly Account[]
	mappings: ReadonlyMap<string, string>
}
type Mapping = { kind: 'linked'; account: Account } | { kind: 'broken' } | { kind: 'unmapped' }
type Context = Input & {
	selectedAccountId: string
	mapping: Mapping | undefined
	index: number
	eligibleAccounts: Account[]
}
export type { ProviderAccountView } from '#lib/contracts/bank-presentation-contract.js'
const events0 = { CHECK: types<EventPayload<{ type: 'CHECK' }, 'CHECK'>>() }
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

export const accountOptionsMachine = setup({
	schemas: { context: types<Context>(), events: events0, input: types<Input>() }
}).createMachine({
	id: 'bank-account-options',
	type: 'parallel',
	context: ({ input }) => ({
		...input,
		selectedAccountId: input.mappings.get(input.provider.id) ?? '',
		mapping: undefined,
		index: 0,
		eligibleAccounts: []
	}),
	states: {
		mapping: {
			initial: 'checkingLink',
			states: {
				checkingLink: {
					always: (args) => {
						const { context } = args
						if (!context.mappings.has(context.provider.id)) {
							return { target: 'unmapped' }
						}
						return { target: 'checkingAccount' }
					}
				},
				checkingAccount: {
					always: (args) => {
						const { context } = args
						if (context.accounts.some((account) => account.id === context.selectedAccountId)) {
							return { target: 'linked' }
						}
						return { target: 'broken' }
					}
				},
				linked: {
					entry: (args) => {
						const { context } = args
						return {
							context: {
								mapping: {
									kind: 'linked',
									account: required(
										context.accounts.find((account) => account.id === context.selectedAccountId)
									)
								}
							}
						}
					}
				},
				broken: {
					entry: () => {
						return { context: { mapping: { kind: 'broken' } } }
					}
				},
				unmapped: {
					entry: () => {
						return { context: { mapping: { kind: 'unmapped' } } }
					}
				}
			}
		},
		destinations: {
			initial: 'nextAccount',
			states: {
				nextAccount: {
					always: (args) => {
						const { context } = args
						if (context.index >= context.accounts.length) {
							return { target: 'checkingAlternatives' }
						}
						return { target: 'checkingAssignment' }
					}
				},
				checkingAssignment: {
					always: (args) => {
						const { context } = args
						if (
							Array.from(context.mappings).some(
								([providerId, accountId]) =>
									providerId !== context.provider.id &&
									accountId === required(context.accounts[context.index]).id
							)
						) {
							return { target: 'advanceAccount' }
						}
						return { target: 'eligibleAccount' }
					}
				},
				eligibleAccount: {
					entry: (args) => {
						const { context } = args
						return {
							context: {
								eligibleAccounts: [
									...context.eligibleAccounts,
									required(context.accounts[context.index])
								]
							}
						}
					},
					always: { target: 'advanceAccount' }
				},
				advanceAccount: {
					entry: (args) => {
						return { context: { index: args.context.index + 1 } }
					},
					always: { target: 'nextAccount' }
				},
				checkingAlternatives: {
					always: (args) => {
						const { context } = args
						if (
							context.eligibleAccounts.some((account) => account.id !== context.selectedAccountId)
						) {
							return { target: 'available' }
						}
						return { target: 'unavailable' }
					}
				},
				available: { tags: ['show-existing'] },
				unavailable: {}
			}
		}
	}
})
