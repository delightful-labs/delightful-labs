import { describe, expect, it } from 'vitest'
import { accountOrderMachine, orderAccounts } from './account-order.js'
import { createActor } from 'xstate'

function start(ids: readonly string[] = ['a', 'b', 'c']) {
	const actor = createActor(accountOrderMachine).start()
	actor.send({ type: 'RESET', ids })
	return actor
}

describe('account ordering', () => {
	it('only moves in edit mode and retains moves when editing finishes', () => {
		const actor = start()
		try {
			actor.send({ type: 'MOVE', id: 'b', direction: 'up' })
			expect(actor.getSnapshot().context.ids).toEqual(['a', 'b', 'c'])
			actor.send({ type: 'EDIT' })
			actor.send({ type: 'MOVE', id: 'b', direction: 'up' })
			expect(actor.getSnapshot().context.ids).toEqual(['b', 'a', 'c'])
			actor.send({ type: 'MOVE', id: 'a', direction: 'down' })
			expect(actor.getSnapshot().context.ids).toEqual(['b', 'c', 'a'])
			actor.send({ type: 'DONE' })
			expect(actor.getSnapshot().matches('viewing')).toBe(true)
			expect(actor.getSnapshot().context.ids).toEqual(['b', 'c', 'a'])
		} finally {
			actor.stop()
		}
	})

	it.each([[], ['a'], ['a', 'b', 'c']])(
		'rejects boundary and unknown moves for %j',
		(...ids: string[]) => {
			const actor = start(ids)
			try {
				actor.send({ type: 'EDIT' })
				for (const event of [
					{ type: 'MOVE', id: ids[0] ?? 'missing', direction: 'up' },
					{ type: 'MOVE', id: ids.at(-1) ?? 'missing', direction: 'down' },
					{ type: 'MOVE', id: 'missing', direction: 'up' },
					{ type: 'MOVE', id: 'missing', direction: 'down' }
				] satisfies Parameters<typeof actor.send>[0][]) {
					expect(actor.getSnapshot().can(event)).toBe(false)
					actor.send(event)
				}
				expect(actor.getSnapshot().context.ids).toEqual(ids)
			} finally {
				actor.stop()
			}
		}
	)

	it('observes additions/removals while editing and resets on scope replacement', () => {
		const actor = start()
		try {
			actor.send({ type: 'EDIT' })
			actor.send({ type: 'OBSERVE', ids: ['c', 'a', 'd'] })
			expect(actor.getSnapshot().matches('editing')).toBe(true)
			actor.send({ type: 'MOVE', id: 'd', direction: 'up' })
			expect(actor.getSnapshot().context.ids).toEqual(['c', 'd', 'a'])
			actor.send({ type: 'RESET', ids: ['x'] })
			expect(actor.getSnapshot().matches('viewing')).toBe(true)
			expect(actor.getSnapshot().context.ids).toEqual(['x'])
		} finally {
			actor.stop()
		}
	})

	it('orders known accounts first, appends new accounts, and ignores unavailable IDs without mutation', () => {
		const accounts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
		const ids = ['missing', 'c', 'a']
		expect(orderAccounts(accounts, ids).map((account) => account.id)).toEqual(['c', 'a', 'b', 'd'])
		expect(accounts.map((account) => account.id)).toEqual(['a', 'b', 'c', 'd'])
		expect(ids).toEqual(['missing', 'c', 'a'])
		expect(orderAccounts(accounts, [])).toEqual(accounts)
	})
})
