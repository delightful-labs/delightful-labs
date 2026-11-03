type Leaf<Value> = Value | PromiseLike<Value>

/** Leaves for a server-owned resource statechart; never an invitation decision by themselves. */
export type InvitationAuthorityTransactions<Transaction, Write> = Readonly<{
	open: () => Leaf<Transaction>
	/** The envelope keeps a native receipt opaque until authority confirmation is selected. */
	commit: (transaction: Transaction) => Leaf<Readonly<{ write: Write }>>
	confirm: (write: Write) => Leaf<void>
	rollback: (transaction: Transaction) => Leaf<boolean>
}>

/** Identity comes from verified request admission, never from the redemption body. */
export type InvitationAuthorityAdmission<Transaction, Write> =
	| Readonly<{
			outcome: 'admitted'
			accountId: string
			transactions: InvitationAuthorityTransactions<Transaction, Write>
	  }>
	| Readonly<{ outcome: 'unauthenticated' | 'unavailable' }>

export type InvitationAuthorityRequest = Readonly<{
	operationId: string
	invitationId: string
	code: string
}>
export type InvitationAuthorityIdentity = Pick<
	InvitationAuthorityRequest,
	'operationId' | 'invitationId'
>
export type InvitationAuthorityMember = Readonly<{
	id: string
	workspaceId: string
	accountId: string
}>
export type InvitationAuthorityEvidence = Readonly<{
	operationId: string
	invitationId: string
	workspaceId: string
	accountId: string
	membershipId: string
}>
export type InvitationAuthorityRecords<Role> = Readonly<{
	invitation: Readonly<{
		id: string
		workspaceId: string
		codeDigest: string
		role: Role
		expiresAt: number | null
		revoked: boolean
		consumed: Readonly<{ accountId: string; operationId: string; membershipId: string }> | null
	}> | null
	membership: InvitationAuthorityMember | null
	evidence: InvitationAuthorityEvidence | null
}>
export type InvitationAuthorityObservation<Role> =
	| Readonly<{ outcome: 'observed'; records: InvitationAuthorityRecords<Role> }>
	| Readonly<{ outcome: 'unavailable' }>
/** An already-decided atomic batch: insert member, consume invitation, insert operation evidence. */
export type InvitationAuthorityPlan<Role> = InvitationAuthorityEvidence &
	Readonly<{ role: Role; acceptedAt: number }>
export type InvitationAuthoritySettlement<Transaction, Write> =
	| Readonly<{ kind: 'notStarted' }>
	| Readonly<{
			kind: 'confirmed'
			decision: import('./workspace-invitation.js').InvitationDecision
	  }>
	| Readonly<{
			kind: 'unknown'
			retained: Readonly<{
				accountId: string
				transaction: Transaction
				write: Write | undefined
				access: Pick<InvitationAuthorityTransactions<Transaction, Write>, 'confirm' | 'rollback'>
			}>
	  }>
/** Server-only output: the host MUST take ownership of retained resources; never serialize them. */
export type InvitationAuthorityResult<Transaction, Write> = InvitationAuthorityIdentity &
	(
		| Readonly<{
				outcome: 'completed'
				settlement: Extract<
					InvitationAuthoritySettlement<Transaction, Write>,
					{ kind: 'confirmed' }
				>
		  }>
		| Readonly<{
				outcome: 'invalidRequest' | 'unauthenticated' | 'unavailable'
				settlement: { kind: 'notStarted' }
		  }>
		| Readonly<{
				outcome: 'failed'
				settlement: Exclude<
					InvitationAuthoritySettlement<Transaction, Write>,
					{ kind: 'confirmed' }
				>
		  }>
		| Readonly<{
				outcome: 'cancelled' | 'closed'
				settlement: InvitationAuthoritySettlement<Transaction, Write>
		  }>
	)
export type InvitationAuthorityEvent = { type: 'CANCEL' | 'SHUTDOWN' }
export type InvitationAuthorityCapability<Credentials, Transaction, Write, Role> = Readonly<{
	admit: (credentials: Credentials) => Leaf<InvitationAuthorityAdmission<Transaction, Write>>
	/** One coherent authority observation in this transaction. Unproven/partial reads are unavailable. */
	read: (
		transaction: Transaction,
		identity: InvitationAuthorityIdentity,
		accountId: string
	) => Leaf<InvitationAuthorityObservation<Role>>
	verifyCode: (code: string, digest: string) => Leaf<boolean>
	now: () => number
	newMembershipId: () => Leaf<string>
	/** Stage the plan unconditionally; no reads, new policy decisions or separate commits. */
	stage: (transaction: Transaction, plan: InvitationAuthorityPlan<Role>) => Leaf<void>
}>
