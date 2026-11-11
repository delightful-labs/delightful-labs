/** Fixed client/identity binding plus a fresh workspace lease generation. */
export type TransferMutationScope = Readonly<{
	binding: object
	workspaceId: string
	generation: number
}>
export type TransferScopeDrainIdentity = Readonly<{
	token: object
	scope: TransferMutationScope
}>
export type TransferScopeDrainResponse =
	| Readonly<{
			type: 'TRANSFER_SCOPE_DRAIN_RESULT'
			request: TransferScopeDrainIdentity
			outcome: 'released' | 'releasedWithFailure' | 'unresolved'
	  }>
	| Readonly<{
			type: 'TRANSFER_SCOPE_DRAIN_RESULT'
			request: TransferScopeDrainIdentity
			outcome: 'rejected'
			reason: 'scopeMismatch' | 'busy' | 'retired'
	  }>
export type TransferScopeDrainRequest = Readonly<{
	request: TransferScopeDrainIdentity
	recipient: { send: (event: TransferScopeDrainResponse) => void }
}>

export type TransferMutationOwnerOutput =
	| Readonly<{ outcome: 'closed' }>
	| Readonly<{
			outcome: 'unresolved'
			scope: TransferMutationScope
			drain: TransferScopeDrainIdentity | undefined
	  }>
