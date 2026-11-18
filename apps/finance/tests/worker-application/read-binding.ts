import { archiveAccount } from '../../src/lib/data/accounts.js'
import { createFinanceReadBinding as nativeBinding } from '../../src/lib/runtime/worker/read-binding.js'
import { app } from '../../src/lib/schema.js'
import { z } from 'zod'

let captured: Parameters<typeof nativeBinding>[0] | undefined
export function createFinanceReadBinding(input: Parameters<typeof nativeBinding>[0]) {
	captured = input
	return nativeBinding(input)
}
const seed = z.strictObject({
	type: z.literal('TEST_SEED'),
	workspaceId: z.uuid(),
	accountId: z.uuid(),
	name: z.string().min(1)
})
const edit = z.strictObject({
	type: z.literal('TEST_EDIT'),
	accountId: z.uuid(),
	name: z.string().min(1)
})
const command = z.discriminatedUnion('type', [
	seed,
	edit,
	z.strictObject({ type: z.literal('TEST_ARCHIVE'), accountId: z.uuid() }),
	z.strictObject({ type: z.literal('TEST_BAD_VIEW') })
])
// Fixture-only SDK controls: the real entry, runtime and read binding stay in use.
// This module is substituted only at the candidate entry's binding import.
self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const decoded = command.safeParse(event.data)
	if (!decoded.success) return
	event.stopImmediatePropagation()
	const reply = event.ports[0],
		native = captured
	if (!reply) return
	void (async () => {
		try {
			if (!native?.isCurrent()) throw new Error('Fixture binding unavailable')
			const { db } = native,
				c = decoded.data
			if (c.type === 'TEST_BAD_VIEW') {
				self.postMessage({ type: 'VIEW', accounts: 'invalid' })
				reply.postMessage({ ok: true })
				return
			}
			if (c.type === 'TEST_ARCHIVE') await archiveAccount(db, c.accountId)
			else if (c.type === 'TEST_EDIT')
				await db.update(app.accounts, c.accountId, { name: c.name }).wait({ tier: 'local' })
			else {
				const identityId = db.getAuthState().session?.user
				if (!identityId) throw new Error('Fixture identity unavailable')
				await db
					.insert(
						app.organizations,
						{
							name: c.name + ' workspace',
							kind: 'personal',
							defaultCurrency: 'USD',
							ownerId: identityId
						},
						{ id: c.workspaceId }
					)
					.wait({ tier: 'local' })
				await db
					.insert(app.organizationMembers, {
						organizationId: c.workspaceId,
						userId: identityId,
						role: 'owner',
						accountAccessMode: 'all'
					})
					.wait({ tier: 'local' })
				await db
					.insert(
						app.accounts,
						{ organizationId: c.workspaceId, name: c.name, kind: 'cash', currency: 'USD' },
						{ id: c.accountId }
					)
					.wait({ tier: 'local' })
			}
			reply.postMessage({ ok: true })
		} catch (error) {
			reply.postMessage({
				ok: false,
				error: error instanceof Error ? error.message : 'Fixture failed'
			})
		} finally {
			reply.close()
		}
	})()
})
