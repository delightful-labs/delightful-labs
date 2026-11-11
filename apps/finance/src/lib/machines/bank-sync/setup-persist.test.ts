import { describe, expect, it, vi } from 'vitest'
import { createSetupPersistenceMachine } from './setup-persist.js'
import { dependencies, connection, id } from './test-fixtures.js'
import { createActor, toPromise, createAsyncLogic } from 'xstate'
import type { InputFrom } from 'xstate'

type Input = InputFrom<ReturnType<typeof createSetupPersistenceMachine>>
const input: Input = {
	scope: {
		ownerId: id(1),
		organizationId: connection.organizationId,
		connectionId: connection.id
	},
	baselineStatus: null,
	encrypted: {
		version: 1,
		ownerId: id(1),
		organizationId: connection.organizationId,
		connectionId: connection.id,
		credentialId: 'credential',
		prfSalt: 'salt',
		iv: 'iv',
		ciphertext: 'encrypted'
	}
}

describe('setup persistence outcomes', () => {
	it.each([null, 'revoked'] satisfies Input['baselineStatus'][])(
		'awaits the selected write with baseline %s',
		async (baselineStatus) => {
			const pending = Promise.withResolvers<void>()
			const insert = vi.fn(() => pending.promise)
			const update = vi.fn(() => pending.promise)
			const actor = createActor(
				createSetupPersistenceMachine(dependencies()).provide({
					actors: {
						insert: createAsyncLogic({ run: insert }),
						update: createAsyncLogic({ run: update })
					}
				}),
				{ input: { ...input, baselineStatus } }
			).start()
			expect(actor.getSnapshot().status).toBe('active')
			expect(insert).toHaveBeenCalledTimes(baselineStatus === null ? 1 : 0)
			expect(update).toHaveBeenCalledTimes(baselineStatus === null ? 0 : 1)
			pending.resolve()
			expect(await toPromise(actor)).toEqual({ settlement: 'locallyPersisted', error: undefined })
		}
	)
	it.each([null, 'revoked'] satisfies Input['baselineStatus'][])(
		'reports unresolved rather than rollback when baseline %s write rejects',
		async (baselineStatus) => {
			const rejectWrite = async (): Promise<void> => {
				throw new Error('unsafe persistence detail')
			}
			const actor = createActor(
				createSetupPersistenceMachine(dependencies()).provide({
					actors: {
						insert: createAsyncLogic({ run: rejectWrite }),
						update: createAsyncLogic({ run: rejectWrite })
					}
				}),
				{ input: { ...input, baselineStatus } }
			).start()
			expect(await toPromise(actor)).toEqual({
				settlement: 'unresolved',
				error: new Error('save_failure')
			})
		}
	)
})
