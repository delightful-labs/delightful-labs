import { createAsyncLogic, setup, types } from 'xstate'
import type { schema } from 'jazz-tools'
import { app, type Account } from '#lib/schema.js'
import { stableUuid } from '#lib/data.js'
import { createAccountWriteMachine, type AccountWrite } from './account-write.js'
import { required } from './identity.js'
import type { Dependencies, OperationWork, ProviderSummary, Result } from './types.js'

type Input = { work: OperationWork; discovered: ProviderSummary[] }
type Candidate = { organizationId: string; accountId: string }
type Context = Input & {
	index: number
	accountId: string | undefined
	snapshot:
		| { account: Account | undefined; links: schema.RowOf<typeof app.simplefinAccountLinks>[] }
		| undefined
	error: unknown
}

/** Restore only accounts created for the same provider identity in this workspace. */
export function createAccountReconnectMachine(dependencies: Dependencies) {
	const actors = {
		identity: createAsyncLogic({
			run: ({ input }: { input: { organizationId: string; providerId: string } }) =>
				stableUuid(input.organizationId, `simplefin-account:${input.providerId}`)
		}),
		snapshot: createAsyncLogic({
			run: async ({ input }: { input: Candidate }) => {
				const [accounts, links] = await Promise.all([
					dependencies.db.all(
						app.accounts.where({ id: input.accountId, organizationId: input.organizationId })
					),
					dependencies.db.all(
						app.simplefinAccountLinks.where({ organizationId: input.organizationId })
					)
				])
				return { account: accounts[0], links }
			}
		}),
		write: createAccountWriteMachine(dependencies)
	}
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<Input>(),
			output: types<Result<undefined>>(),
			events: { CANCEL: types<{}>(), SHUTDOWN: types<{}>() },
			children: { write: types<import('xstate').ActorRefFrom<typeof actors.write>>() }
		},
		actors
	}).createMachine({
		id: 'bank-account-reconnect',
		context: ({ input }) => ({
			...input,
			index: 0,
			accountId: undefined,
			snapshot: undefined,
			error: undefined
		}),
		initial: 'next',
		on: {
			CANCEL: () => ({ target: '.failed', context: { error: new Error('disconnected') } }),
			SHUTDOWN: () => ({ target: '.failed', context: { error: new Error('disconnected') } })
		},
		output: ({ context }) =>
			context.error === undefined
				? { ok: true, value: undefined }
				: { ok: false, error: context.error },
		states: {
			next: {
				type: 'choice',
				choice: ({ context }) =>
					context.index >= context.discovered.length
						? { target: 'complete' }
						: { target: 'identifying' }
			},
			identifying: {
				invoke: {
					src: 'identity',
					input: ({ context }) => ({
						organizationId: context.work.scope.organizationId,
						providerId: required(context.discovered[context.index]).id
					}),
					onDone: ({ event }) => ({ target: 'reading', context: { accountId: event.output } }),
					onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
				}
			},
			reading: {
				invoke: {
					src: 'snapshot',
					input: ({ context }) => ({
						organizationId: context.work.scope.organizationId,
						accountId: required(context.accountId)
					}),
					onDone: ({ event }) => ({ target: 'checking', context: { snapshot: event.output } }),
					onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
				}
			},
			checking: {
				type: 'choice',
				choice: ({ context }) => {
					const { account, links } = required(context.snapshot)
					const provider = required(context.discovered[context.index])
					if (
						!account ||
						Boolean(account.archivedAt) ||
						account.currency !== provider.currency ||
						links.some(
							(link) => link.simplefinAccountId === provider.id || link.accountId === account.id
						) ||
						context.discovered.filter((row) => row.id === provider.id).length !== 1
					)
						return { target: 'advance' }
					return { target: 'writing' }
				}
			},
			writing: {
				initial: 'active',
				states: { active: {}, draining: {} },
				on: {
					CANCEL: (_, enq) => {
						enq.sendTo('write', { type: 'CANCEL' })
						return { target: '.draining', context: { error: new Error('disconnected') } }
					},
					SHUTDOWN: (_, enq) => {
						enq.sendTo('write', { type: 'SHUTDOWN' })
						return { target: '.draining', context: { error: new Error('disconnected') } }
					}
				},
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }) =>
						({
							kind: 'map',
							work: context.work,
							provider: required(context.discovered[context.index]),
							accountId: required(context.accountId)
						}) satisfies AccountWrite,
					onDone: ({ context, event }) => {
						if (context.error !== undefined) return { target: 'failed' }
						if (!event.output.ok)
							return { target: 'failed', context: { error: event.output.error } }
						return { target: 'advance' }
					},
					onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
				}
			},
			advance: {
				always: ({ context }) => ({
					target: 'next',
					context: { index: context.index + 1, accountId: undefined, snapshot: undefined }
				})
			},
			complete: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
