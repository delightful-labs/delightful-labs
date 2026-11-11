import { afterEach, describe, expect, it } from 'vitest'
import {
	bankAvailabilityMachine,
	availabilityObservation,
	type AvailabilityEvent
} from './availability.js'
import { bankHistoryMachine, type HistoryEvent } from './history.js'
import { collectReports, publishAvailability } from './reports.fixture.js'
import { connection, id, source } from './test-fixtures.js'
import { bankCredentialFingerprint, type BankSource, type Connection } from './types.js'
import { createActor } from 'xstate'

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
})

function availability(initial: BankSource = source) {
	const recipient = collectReports<AvailabilityEvent>()
	const actor = createActor(bankAvailabilityMachine, {
		input: { ...initial, generation: 7, recipient }
	}).start()
	cleanups.push(
		() => actor.stop(),
		() => recipient.stop()
	)
	return { actor, reports: () => recipient.getSnapshot().context.map((event) => event.report) }
}
function history(connection: Connection | undefined) {
	const recipient = collectReports<HistoryEvent>()
	const actor = createActor(bankHistoryMachine, {
		input: { revision: 7, recipient }
	}).start()
	cleanups.push(
		() => actor.stop(),
		() => recipient.stop()
	)
	actor.send({ type: 'CONNECTION_SELECTED', revision: 7, connectionId: connection?.id })
	actor.send({ type: 'HISTORY_CHANGED', revision: 7, records: connection ? [connection] : [] })
	return { actor, reports: () => recipient.getSnapshot().context }
}

describe('public bank availability reports', () => {
	it.each([
		{ name: 'connected', source, mode: 'connected', canConnect: true, canOperate: true },
		{
			name: 'missing credential',
			source: { ...source, connections: [] },
			mode: 'setup',
			canConnect: true,
			canOperate: false
		},
		{
			name: 'incomplete credential',
			source: { ...source, connections: [{ ...connection, ciphertext: null }] },
			mode: 'setup',
			canConnect: true,
			canOperate: false
		},
		{
			name: 'revoked membership',
			source: { ...source, membership: null },
			mode: 'restricted',
			canConnect: false,
			canOperate: false
		},
		{
			name: 'unready session',
			source: { ...source, sessionReady: false },
			mode: 'restricted',
			canConnect: false,
			canOperate: false
		}
	])(
		'publishes $name decisions through its typed recipient',
		({ source, mode, canConnect, canOperate }) => {
			const f = availability(source)
			expect(f.reports().at(-1)).toMatchObject({ generation: 7, mode, canConnect, canOperate })
			expect(f.reports().every((report) => report.generation === 7)).toBe(true)
		}
	)
	it('selects only the signed-in owner’s current organization connection', () => {
		const f = availability({
			...source,
			connections: [
				{ ...connection, id: id(8), ownerId: id(9) },
				{ ...connection, id: id(10), organizationId: id(11) },
				connection
			]
		})
		expect(f.actor.getSnapshot().context.connection).toEqual(connection)
	})
	it('reports setup controls while retaining credential facts, then restores the current decision', () => {
		const f = availability()
		f.actor.send({ type: 'SETUP_STARTED' })
		expect(f.reports().at(-1)).toMatchObject({
			generation: 7,
			mode: 'setup',
			canOperate: false
		})
		expect(availabilityObservation(f.actor.getSnapshot())).toMatchObject({
			allowed: true,
			connected: true
		})
		f.actor.send({ type: 'SETUP_ENDED' })
		expect(f.reports().at(-1)).toMatchObject({ generation: 7, mode: 'connected', canOperate: true })
	})
	it('publishes revocation and restoration with the supplied observation generations during setup', () => {
		const f = availability()
		f.actor.send({ type: 'SETUP_STARTED' })
		publishAvailability(f.actor, { ...source, membership: null }, 8)
		expect(f.reports().at(-1)).toMatchObject({
			generation: 8,
			mode: 'restricted',
			canConnect: false,
			canOperate: false
		})
		f.actor.send({ type: 'SETUP_ENDED' })
		expect(f.reports().at(-1)).toMatchObject({ generation: 8, mode: 'restricted' })
		publishAvailability(f.actor, source, 9)
		expect(f.reports().at(-1)).toMatchObject({ generation: 9, mode: 'connected', canOperate: true })
	})
	it('reports credential replacement without reusing the previous fingerprint', () => {
		const f = availability()
		const original = bankCredentialFingerprint(f.actor.getSnapshot().context.connection)
		publishAvailability(
			f.actor,
			{ ...source, connections: [{ ...connection, ciphertext: 'new-ciphertext' }] },
			8
		)
		expect(f.reports().at(-1)).toMatchObject({
			generation: 8,
			mode: 'connected'
		})
		expect(bankCredentialFingerprint(f.actor.getSnapshot().context.connection)).not.toBe(original)
	})
})

describe('public bank history reports', () => {
	it.each(['succeeded', 'partial', 'failed'] satisfies NonNullable<Connection['lastOutcome']>[])(
		'publishes saved %s independently of a current attempt',
		(lastOutcome) => {
			const time = new Date('2026-10-17T00:00:00Z')
			const f = history({
				...connection,
				lastSyncAt: time,
				lastOutcome,
				importedCount: 2,
				existingCount: 3,
				omittedCount: 4
			})
			expect(f.reports()).toHaveLength(3)
			expect(f.reports().at(-1)).toEqual({
				type: 'HISTORY_REPORTED',
				revision: 7,
				connectionId: connection.id,
				summary: { time, outcomeKey: `bank.${lastOutcome}`, imported: 2, existing: 3, omitted: 4 }
			})
			f.actor.send({ type: 'BINDING_CHANGED', revision: 8 })
			expect(f.reports().at(-1)).toEqual({
				type: 'HISTORY_REPORTED',
				revision: 8,
				connectionId: undefined,
				summary: undefined
			})
		}
	)
	it.each([undefined, connection, { ...connection, lastSyncAt: new Date(), lastOutcome: null }])(
		'publishes absence for incomplete history',
		(connection) => {
			const f = history(connection)
			expect(f.reports()).toHaveLength(3)
			expect(f.reports().at(-1)).toEqual({
				type: 'HISTORY_REPORTED',
				revision: 7,
				connectionId: connection?.id,
				summary: undefined
			})
		}
	)
})
