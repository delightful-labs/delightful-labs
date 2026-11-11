// Server-side workflow consumer with unrelated app records. No native SDK or Finance imports.
import { createActor, toPromise } from 'xstate'
import { createInvitationAuthorityMachine } from 'delightful-local-first/workspace/invitations/authority-workflow'

/** @typedef {{id:string}} Transaction */
/** @typedef {{receipt:string}} Write */
/** @typedef {'collaborator'} Role */
/** @type {Transaction} */
const transaction = { id: 'exclusive-attempt' }
/** @type {Write} */
const write = { receipt: 'authority-receipt' }
/** @type {import('delightful-local-first/workspace/invitations/authority-contracts').DetachedTransaction<Transaction, {write: Write}>[]} */
const detached = []
/** @type {import('delightful-local-first/workspace/invitations/authority-contracts').InvitationAuthorityPlan<Role>[]} */
const staged = []
/** @type {import('delightful-local-first/workspace/invitations/authority-contracts').InvitationAuthorityTransactions<Transaction,Write>} */
const transactions = {
	retainDetached: (custody) => {
		detached.push(custody)
	},
	open: () => transaction,
	commit: (tx) => {
		if (tx !== transaction || staged.length !== 1) throw new Error('Unexpected commit')
		return { write }
	},
	confirm: (receipt) => {
		if (receipt !== write) throw new Error('Unexpected authority receipt')
	},
	rollback: () => true
}
/** @type {import('delightful-local-first/workspace/invitations/authority-contracts').InvitationAuthorityCapability<{proof:string},Transaction,Write,Role>} */
const capability = {
	admit: (credentials) =>
		credentials.proof === 'synthetic-proof'
			? { outcome: 'admitted', accountId: 'test-app-reader', transactions }
			: { outcome: 'unauthenticated' },
	read: async (tx, identity, accountId) => {
		if (
			tx !== transaction ||
			identity.invitationId !== 'test-app-invite' ||
			accountId !== 'test-app-reader'
		)
			throw new Error('Unexpected authority scope')
		return {
			outcome: 'observed',
			records: {
				invitation: {
					id: 'test-app-invite',
					workspaceId: 'notebook',
					role: 'collaborator',
					codeDigest: 'synthetic-digest',
					expiresAt: 6000,
					revoked: false,
					consumed: null
				},
				membership: null,
				evidence: null
			}
		}
	},
	verifyCode: (code, digest) => code === 'synthetic-code' && digest === 'synthetic-digest',
	now: () => 5000,
	newMembershipId: () => 'test-app-membership',
	stage: (tx, plan) => {
		if (tx !== transaction) throw new Error('Unexpected transaction')
		staged.push(plan)
	}
}
const actor = createActor(createInvitationAuthorityMachine(capability), {
	input: {
		credentials: { proof: 'synthetic-proof' },
		request: {
			operationId: 'test-app-redemption',
			invitationId: 'test-app-invite',
			code: 'synthetic-code'
		}
	}
})
try {
	actor.start()
	const result = await toPromise(actor)
	if (
		result.outcome !== 'completed' ||
		result.settlement.decision.outcome !== 'joined' ||
		!('membershipId' in result.settlement.decision) ||
		result.settlement.decision.membershipId !== 'test-app-membership'
	)
		throw new Error('Packaged authority did not confirm its result')
	const plan = staged[0]
	if (
		staged.length !== 1 ||
		plan?.accountId !== 'test-app-reader' ||
		plan.role !== 'collaborator' ||
		plan.operationId !== 'test-app-redemption' ||
		plan.acceptedAt !== 5000
	)
		throw new Error('Packaged authority lost its verified staging plan')
	const context = actor.getSnapshot().context
	if (
		context.request !== undefined ||
		context.resources.credentials !== undefined ||
		context.resources.transaction !== undefined ||
		context.admission !== undefined
	)
		throw new Error('Packaged authority retained transient resources')
} finally {
	actor.stop()
}
