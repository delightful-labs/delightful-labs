import { app } from '#lib/schema.js'
import type { CredentialEnvelope, CredentialScope } from '#lib/validation/integrations.js'
import type { Connection, Dependencies } from './types.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Input = {
	scope: CredentialScope
	baselineStatus: Connection['status'] | null
	encrypted: CredentialEnvelope
}
type Write = Pick<Input, 'scope' | 'encrypted'>
function connectionValues(input: Write, claimedAt: Date) {
	return {
		organizationId: input.scope.organizationId,
		ownerId: input.scope.ownerId,
		accessUrl: '',
		credentialVersion: input.encrypted.version,
		credentialId: input.encrypted.credentialId,
		prfSalt: input.encrypted.prfSalt,
		iv: input.encrypted.iv,
		ciphertext: input.encrypted.ciphertext,
		status: 'active',
		claimedAt
	} satisfies Pick<
		Connection,
		| 'organizationId'
		| 'ownerId'
		| 'accessUrl'
		| 'credentialVersion'
		| 'credentialId'
		| 'prfSalt'
		| 'iv'
		| 'ciphertext'
		| 'status'
		| 'claimedAt'
	>
}
type Context = Input & { error: Error | undefined }
type Output =
	{ settlement: 'locallyPersisted'; error: undefined } | { settlement: 'unresolved'; error: Error }

export function createSetupPersistenceMachine({ db }: Dependencies) {
	const actors = {
		insert: createAsyncLogic<void, Write>({
			run: async ({ input, signal }) => {
				signal.throwIfAborted()
				await db
					.insert(app.simplefinConnections, connectionValues(input, new Date()), {
						id: input.scope.connectionId
					})
					.wait({ tier: 'local' })
			}
		}),
		update: createAsyncLogic<void, Write>({
			run: async ({ input, signal }) => {
				signal.throwIfAborted()
				await db
					.update(
						app.simplefinConnections,
						input.scope.connectionId,
						connectionValues(input, new Date())
					)
					.wait({ tier: 'local' })
			}
		})
	}
	const events0 = { SAVE: types<EventPayload<{ type: 'SAVE' }, 'SAVE'>>() }
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['insert']>
				| import('xstate').OutputFrom<(typeof actors)['update']>
		  >
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<Input>(),
			output: types<Output>(),
			children: {
				insert: types<import('xstate').ActorRefFrom<(typeof actors)['insert']>>(),
				update: types<import('xstate').ActorRefFrom<(typeof actors)['update']>>()
			}
		},
		actors
	}).createMachine({
		id: 'bank-setup-persistence',
		context: ({ input }) => ({ ...input, error: undefined }),
		initial: 'choosingWrite',
		output: ({ context }): Output =>
			context.error
				? { settlement: 'unresolved', error: context.error }
				: { settlement: 'locallyPersisted', error: undefined },
		states: {
			choosingWrite: {
				always: (args) => {
					if (args.context.baselineStatus !== null) {
						return { target: 'updating' }
					}
					return { target: 'inserting' }
				}
			},
			inserting: {
				invoke: {
					src: 'insert',
					input: ({ context }) => ({ scope: context.scope, encrypted: context.encrypted }),
					onDone: { target: 'saved' },
					onError: { target: 'failed' }
				}
			},
			updating: {
				invoke: {
					src: 'update',
					input: ({ context }) => ({ scope: context.scope, encrypted: context.encrypted }),
					onDone: { target: 'saved' },
					onError: { target: 'failed' }
				}
			},
			saved: { type: 'final' },
			failed: {
				type: 'final',
				entry: () => {
					return { context: { error: new Error('save_failure') } }
				}
			}
		}
	})
}
