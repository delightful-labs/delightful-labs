import { afterEach, vi } from 'vitest'
import { Transaction } from 'jazz-tools'
import {
	workspaceIntegrityAssessment,
	type IntegrityAssessmentInput,
	type IntegrityPlan,
	type IntegrityRecords
} from './workspace-integrity-assessment.js'
import { workspaceIntegrityTransaction } from './workspace-integrity-transaction.js'
import { workspaceIntegrity } from './workspace-integrity.js'
import { createActor } from 'xstate'
import type { AnyActorRef } from 'xstate'

export const scope = {
	userId: '11111111-1111-4111-8111-111111111111',
	profileId: '22222222-2222-4222-8222-222222222222',
	organizationId: '33333333-3333-4333-8333-333333333333'
}
export const membership: IntegrityRecords['memberships'][number] = {
	id: '44444444-4444-4444-8444-444444444444',
	organizationId: scope.organizationId,
	userId: scope.userId,
	profileId: scope.profileId,
	role: 'owner',
	accountAccessMode: 'all'
}
export function records(overrides: Partial<IntegrityRecords> = {}): IntegrityRecords {
	return {
		profiles: [
			{
				id: scope.profileId,
				userId: scope.userId,
				initialWorkspaceId: scope.organizationId,
				displayName: null,
				avatarData: null,
				avatarMimeType: null
			}
		],
		organizations: [
			{
				id: scope.organizationId,
				name: 'Shared business',
				kind: 'business',
				ownerId: '77777777-7777-4777-8777-777777777777',
				defaultCurrency: 'USD'
			}
		],
		memberships: [{ ...membership }],
		...overrides
	}
}
export function brokenRecords() {
	return records({ memberships: [{ ...membership, profileId: null }] })
}
export function assess(input: Partial<IntegrityAssessmentInput> = {}) {
	return createActor(workspaceIntegrityAssessment, {
		input: { ...scope, records: records(), ...input }
	})
		.start()
		.getSnapshot()
}
const actors: { stop: () => void }[] = []
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
	vi.restoreAllMocks()
})
function start<T extends { start: () => unknown; stop: () => void }>(actor: T): T {
	actors.push(actor)
	actor.start()
	return actor
}

/** Mock SDK I/O, while running real assessment, coordinator and transaction actors. */
export function integrityFixture(
	local = brokenRecords(),
	authoritative = local,
	transactional = authoritative
) {
	const tx = new Transaction('mergeable', () => {
		throw new Error('Fixture must not open a Jazz runtime')
	})
	const all = vi.spyOn(tx, 'all').mockResolvedValue([])
	const insert = vi.spyOn(tx, 'insert')
	const update = vi.spyOn(tx, 'update').mockImplementation(() => {})
	const rollback = vi.spyOn(tx, 'rollback').mockResolvedValue(true)
	const wait = vi.fn(async (_options: { tier: 'local' }) => {})
	// The SDK handle is opaque; this follows the existing transaction fixture boundary.
	const commit = vi.spyOn(tx, 'commit').mockImplementation(vi.fn().mockReturnValue({ wait }))
	const beginTransaction = vi.fn(() => tx)
	const discover = vi.fn().mockResolvedValue([])
	const getConfig = vi.fn().mockReturnValue({ serverUrl: 'https://unused.invalid' })
	const db = { all: discover, getConfig, beginTransaction }
	for (const snapshot of [local, authoritative]) {
		for (const rows of [snapshot.profiles, snapshot.organizations, snapshot.memberships])
			discover.mockResolvedValueOnce(rows)
	}
	for (const rows of [
		transactional.profiles,
		transactional.organizations,
		transactional.memberships
	])
		all.mockResolvedValueOnce(rows)
	function transaction(expected?: IntegrityPlan) {
		const assessment = assess({ records: authoritative }).output
		if (assessment?.outcome !== 'repair' && !expected)
			throw new Error('Fixture needs an expected repair')
		const plan = expected ?? (assessment?.outcome === 'repair' ? assessment.plan : undefined)
		if (!plan) throw new Error('Missing fixture plan')
		return start(
			createActor(workspaceIntegrityTransaction, {
				input: { ...scope, db, expected: plan }
			})
		)
	}
	function coordinator() {
		return start(createActor(workspaceIntegrity, { input: { ...scope, db } }))
	}
	return {
		tx,
		all,
		insert,
		update,
		rollback,
		wait,
		commit,
		beginTransaction,
		discover,
		getConfig,
		db,
		transaction,
		coordinator
	}
}
