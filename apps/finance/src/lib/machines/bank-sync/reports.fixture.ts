import { collectEvents as collectReports } from '../report-collector.fixture.js'
import { bankAvailabilityMachine, type AvailabilityEvent } from './availability.js'
import {
	bankData,
	bankObservation,
	type BankAccess,
	type BankObservationEvent,
	type BankSource
} from './types.js'
import { required } from './identity.js'
import { createActor, createStepLogic } from 'xstate'
import type { ActorRef, ActorRefFrom, Snapshot, EventObject } from 'xstate'

export function accessFor(source: BankSource): BankAccess {
	const observed = bankObservation(source)
	return observed.allowed
		? {
				kind: 'allowed',
				organizationId: required(observed.organizationId ?? undefined),
				userId: required(observed.userId)
			}
		: {
				kind: source.sessionReady ? 'restricted' : 'waiting',
				organizationId: source.organizationId,
				userId: source.userId
			}
}

/** Simulate the coordinator's access report followed by the integration's scoped observations. */
export function publishBankSource(
	actor: ActorRef<Snapshot<unknown>, BankObservationEvent>,
	source: BankSource,
	revision: number
) {
	actor.send({ type: 'WORKSPACE_ACCESS_CHANGED', revision, access: accessFor(source) })
	actor.send({ type: 'CONNECTIONS_CHANGED', revision, connections: source.connections })
	actor.send({ type: 'MAPPING_DATA_CHANGED', revision, data: bankData(source) })
	actor.send({ type: 'HISTORY_CHANGED', revision, records: source.connections })
}

export function publishAvailability(
	actor: ActorRefFrom<typeof bankAvailabilityMachine>,
	source: BankSource,
	generation: number
) {
	actor.send({ type: 'ACCESS_CHANGED', generation, access: accessFor(source) })
	actor.send({
		type: 'CONNECTION_CHANGED',
		generation,
		connection: bankObservation(source).connection
	})
}

export { collectEvents as collectReports } from '../report-collector.fixture.js'

export function availabilityReport(source: BankSource, generation: number) {
	const recipient = collectReports<AvailabilityEvent>()
	const actor = createActor(bankAvailabilityMachine, {
		input: { ...source, generation, recipient }
	}).start()
	const report = recipient.getSnapshot().context.at(-1)?.report
	actor.stop()
	recipient.stop()
	if (!report) throw new Error('Expected availability report')
	return report
}
