import { describe, expect, it } from 'vitest'
import { bankAvailabilityMachine } from './availability.js'
import { accountOptionsMachine } from './account-options.js'
import { bankHistoryMachine, type HistoryEvent } from './history.js'
import { collectReports, publishAvailability } from './reports.fixture.js'
import { account, connection, id, source } from './test-fixtures.js'
import type { BankSource } from './types.js'
import { createActor, initialTransition } from 'xstate'

describe('bank availability and presentation decisions', () => {
	it.each([
		{ name: 'transitioning session', change: { sessionReady: false } },
		{ name: 'missing user', change: { userId: undefined } },
		{ name: 'missing organization', change: { organizationId: null } },
		{ name: 'missing membership', change: { membership: undefined } },
		{
			name: 'another identity membership',
			change: { membership: { ...source.membership!, userId: id(8) } }
		},
		{ name: 'viewer', change: { membership: { ...source.membership!, role: 'viewer' } } }
	] satisfies { name: string; change: Partial<BankSource> }[])('denies $name', ({ change }) => {
		const state = initialTransition(bankAvailabilityMachine, { ...source, ...change })[0]
		expect(state.hasTag('allowed')).toBe(false)
		expect(state.hasTag('show-sync')).toBe(false)
		expect(state.hasTag('show-restricted')).toBe(true)
	})

	it('revokes sync controls when ciphertext becomes incomplete and restores them only from a fresh observation', () => {
		const actor = createActor(bankAvailabilityMachine, { input: source }).start()
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(true)
		publishAvailability(actor, { ...source, connections: [{ ...connection, ciphertext: null }] }, 1)
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(false)
		expect(actor.getSnapshot().hasTag('show-setup')).toBe(true)
		publishAvailability(actor, source, 2)
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(true)
		actor.stop()
	})

	it('hides sync during setup and rechecks access before restoring controls', () => {
		const actor = createActor(bankAvailabilityMachine, { input: source }).start()
		actor.send({ type: 'SETUP_STARTED' })
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(false)
		publishAvailability(actor, { ...source, sessionReady: false }, 1)
		actor.send({ type: 'SETUP_ENDED' })
		expect(actor.getSnapshot().hasTag('show-sync')).toBe(false)
		actor.stop()
	})

	it('excludes accounts already assigned to another provider and identifies broken links', () => {
		const input = {
			provider: { id: 'checking', name: 'Provider', currency: 'USD' },
			accounts: [account, { ...account, id: id(6) }],
			mappings: new Map([
				['savings', account.id],
				['checking', id(7)]
			])
		}
		const state = initialTransition(accountOptionsMachine, input)[0]
		expect(state.context.mapping).toEqual({ kind: 'broken' })
		expect(state.context.eligibleAccounts.map((row) => row.id)).toEqual([id(6)])
		expect(state.hasTag('show-existing')).toBe(true)
	})

	it('does not offer the current linked account as an alternative', () => {
		const state = initialTransition(accountOptionsMachine, {
			provider: { id: 'checking', name: 'Provider', currency: 'USD' },
			accounts: [account],
			mappings: new Map([['checking', account.id]])
		})[0]
		expect(state.context.mapping).toEqual({ kind: 'linked', account })
		expect(state.hasTag('show-existing')).toBe(false)
	})

	it.each(['succeeded', 'partial', 'failed'])(
		'projects persisted %s results independently of the current operation',
		(outcome) => {
			const lastOutcome =
				outcome === 'succeeded' ? 'succeeded' : outcome === 'partial' ? 'partial' : 'failed'
			const recipient = collectReports<HistoryEvent>()
			const actor = createActor(bankHistoryMachine, { input: { revision: 0, recipient } }).start()
			actor.send({ type: 'CONNECTION_SELECTED', revision: 0, connectionId: connection.id })
			actor.send({
				type: 'HISTORY_CHANGED',
				revision: 0,
				records: [
					{
						...connection,
						lastOutcome,
						lastSyncAt: new Date('2026-10-17'),
						importedCount: 2,
						existingCount: 3,
						omittedCount: 4
					}
				]
			})
			expect(actor.getSnapshot().context.summary).toEqual({
				time: new Date('2026-10-17'),
				outcomeKey: `bank.${outcome}`,
				imported: 2,
				existing: 3,
				omitted: 4
			})
			actor.stop()
			recipient.stop()
		}
	)
})
