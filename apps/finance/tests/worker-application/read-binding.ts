import type { InspectionEvent } from 'xstate'
import { diagnosticError } from '../../src/lib/diagnostics/error-details.js'
import { createFinanceWorkerBinding as nativeBinding } from '../../src/lib/runtime/worker/binding.js'
import { app } from '../../src/lib/schema.js'
import { z } from 'zod'
import { ReadTier } from 'jazz-tools'

export function inspectWorkerFailure(event: InspectionEvent) {
	if (event.type !== '@xstate.transition') return
	const error =
		event.snapshot.status === 'error'
			? event.snapshot.error
			: event.eventType === 'xstate.error.actor'
				? event.event.error
				: undefined
	if (error !== undefined)
		console.error(
			'Native worker actor error',
			JSON.stringify({ actorSessionId: event.actorRef.sessionId, error: diagnosticError(error) })
		)
}
let captured: Parameters<typeof nativeBinding>[0] | undefined
let archiveReceipt: ReturnType<typeof Promise.withResolvers<void>> | undefined
export function createFinanceWorkerBinding(input: Parameters<typeof nativeBinding>[0]) {
	captured = input
	const native = nativeBinding(input)
	return {
		...native,
		archiveAccount: async (accountId: string) => {
			const receipt = archiveReceipt
			await native.archiveAccount(accountId)
			await receipt?.promise
		}
	}
}
const seed = z.strictObject({
	type: z.literal('TEST_SEED'),
	workspaceId: z.uuid(),
	accountId: z.uuid(),
	name: z.string().min(1),
	currency: z.enum(['USD', 'TZS'])
})
const edit = z.strictObject({
	type: z.literal('TEST_EDIT'),
	accountId: z.uuid(),
	name: z.string().min(1)
})
const command = z.discriminatedUnion('type', [
	seed,
	z.strictObject({
		type: z.literal('TEST_SEED_LEDGER'),
		workspaceId: z.uuid(),
		accountId: z.uuid()
	}),
	edit,
	z.strictObject({ type: z.literal('TEST_TRANSACTIONS'), workspaceId: z.uuid() }),
	z.strictObject({ type: z.literal('TEST_HOLD_ARCHIVE') }),
	z.strictObject({ type: z.literal('TEST_RELEASE_ARCHIVE') }),
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
			if (c.type === 'TEST_SEED_LEDGER') {
				const category = (
					await db.all(app.categories.where({ organizationId: c.workspaceId, kind: 'expense' }), {
						tier: ReadTier.LocalFirst
					})
				)[0]
				if (!category) throw new Error('Fixture category unavailable')
				const tx = db.beginTransaction()
				for (let i = 0; i < 40; i++)
					tx.insert(app.transactions, {
						organizationId: c.workspaceId,
						accountId: c.accountId,
						categoryId: category.id,
						amountMinor: 100,
						currency: 'USD',
						kind: 'expense',
						bookedOn: '2026-11-18',
						source: 'manual',
						description: 'Ledger record ' + i,
						memo: i === 39 ? 'ledger memo needle' : null,
						paymentMethod: null,
						checkId: null
					})
				await tx.commit().wait({ tier: 'local' })
				reply.postMessage({ ok: true })
				return
			}

			if (c.type === 'TEST_TRANSACTIONS') {
				const rows = await db.all(
					app.transactions
						.where({ organizationId: c.workspaceId })
						.include({ check: true })
						.orderBy('bookedOn'),
					{ tier: ReadTier.LocalFirst }
				)
				reply.postMessage({
					ok: true,
					transactions: rows.map(
						({
							id,
							accountId,
							amountMinor,
							currency,
							kind,
							description,
							paymentMethod,
							checkId,
							check
						}) => ({
							accountId,
							checkNumber: check?.checkNumber ?? null,
							checkAccountId: check?.accountId ?? null,
							id,
							amountMinor,
							currency,
							kind,
							description,
							paymentMethod,
							checkId
						})
					)
				})
				return
			}
			if (c.type === 'TEST_HOLD_ARCHIVE') archiveReceipt = Promise.withResolvers<void>()
			else if (c.type === 'TEST_RELEASE_ARCHIVE') {
				archiveReceipt?.resolve()
				archiveReceipt = undefined
			} else if (c.type === 'TEST_EDIT')
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
							defaultCurrency: c.currency,
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
					.insert(app.categories, {
						organizationId: c.workspaceId,
						name: 'Worker expense',
						kind: 'expense',
						isSystem: true
					})
					.wait({ tier: 'local' })
				await db
					.insert(app.categories, {
						organizationId: c.workspaceId,
						name: 'Worker income',
						kind: 'income',
						isSystem: true
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
