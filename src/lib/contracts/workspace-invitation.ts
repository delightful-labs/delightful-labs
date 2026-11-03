/** A reply from authenticated authority, never a local membership observation. */
export type InvitationDecision =
	| { outcome: 'joined' | 'alreadyMember'; membershipId: string }
	| { outcome: 'invalid' | 'expired' | 'used' | 'revoked' | 'denied' }
export type InvitationRequest<Scope> = Readonly<{
	operationId: string
	invitationId: string
	scope: Scope
	/** Transient bearer material: never persist, inspect or put in a path/query. */
	code: string
}>
export type InvitationIdentity<Scope> = Pick<
	InvitationRequest<Scope>,
	'operationId' | 'invitationId' | 'scope'
>
export type InvitationReadiness =
	| { kind: 'ready' }
	| { kind: 'blocked'; reason: 'sessionUnavailable' | 'authorityUnavailable' }
export type InvitationSettlement =
	| { kind: 'notStarted' }
	| { kind: 'confirmed'; decision: InvitationDecision }
	| { kind: 'unknown' }
export type InvitationResult<Scope> = InvitationIdentity<Scope> &
	(
		| { outcome: 'completed'; settlement: Extract<InvitationSettlement, { kind: 'confirmed' }> }
		| { outcome: 'invalid'; settlement: { kind: 'notStarted' } }
		| {
				outcome: 'blocked'
				reason: 'sessionUnavailable' | 'authorityUnavailable'
				settlement: { kind: 'notStarted' }
		  }
		| { outcome: 'failed'; settlement: { kind: 'notStarted' | 'unknown' } }
		| { outcome: 'cancelled' | 'scopeChanged' | 'closed'; settlement: InvitationSettlement }
	)
export type InvitationEvent = { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN' }
export type InvitationCapability<Scope> = Readonly<{
	/** Pure local readiness only; authorization is enforced at the authority. */
	assess: (identity: InvitationIdentity<Scope>) => InvitationReadiness
	/** One authenticated request. Server orchestration belongs in a separate statechart. */
	redeem: (request: InvitationRequest<Scope>) => PromiseLike<InvitationDecision>
}>
