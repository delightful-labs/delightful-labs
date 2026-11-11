// Consume built exports with an unrelated app scope and a single authenticated-request capability.
import { createActor, toPromise } from 'xstate'
import { createInvitationRedemptionMachine } from 'delightful-local-first/workspace/invitations/workflow'

/** @typedef {{attachment:object;generation:number;app:'test-app'}} Scope */
/** @type {Scope} */
const scope = { attachment: {}, generation: 2, app: 'test-app' }
/** @type {import('delightful-local-first/workspace/invitations/contracts').InvitationRequest<Scope>} */
const request = {
	operationId: 'redemption',
	invitationId: 'invitation',
	scope,
	code: 'synthetic-consumer-code'
}
let calls = 0
/** @type {import('delightful-local-first/workspace/invitations/contracts').InvitationCapability<Scope>} */
const capability = {
	assess: (identity) => {
		if (identity.scope !== scope) throw new Error('Unexpected scope')
		return { kind: 'ready' }
	},
	redeem: async (input) => {
		calls++
		if (input.operationId !== request.operationId || input.code !== request.code)
			throw new Error('Unexpected request')
		return { outcome: 'joined', membershipId: 'test-app-member' }
	}
}
const actor = createActor(createInvitationRedemptionMachine(), { input: { request, capability } })
try {
	actor.start()
	const result = await toPromise(actor)
	if (
		result.outcome !== 'completed' ||
		result.settlement.decision.outcome !== 'joined' ||
		!('membershipId' in result.settlement.decision) ||
		result.settlement.decision.membershipId !== 'test-app-member' ||
		result.scope !== scope ||
		calls !== 1
	)
		throw new Error('Packaged redemption lost authority confirmation or correlation')
	const context = actor.getSnapshot().context
	if (context.request !== undefined || context.capability !== undefined)
		throw new Error('Packaged redemption retained transient resources')
} finally {
	actor.stop()
}
