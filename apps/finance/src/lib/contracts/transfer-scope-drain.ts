/** Fixed client/identity binding plus a fresh workspace lease generation. */
export type TransferMutationScope = Readonly<{
	lease?: import('delightful-local-first/workspace/contracts').WorkspaceLease | undefined
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

/** One native operation scope, including the exact admitted workspace activation. */
export function sameTransferMutationScope(
	left: TransferMutationScope | undefined,
	right: TransferMutationScope | undefined
) {
	return (
		left !== undefined &&
		right !== undefined &&
		left.binding === right.binding &&
		left.workspaceId === right.workspaceId &&
		left.generation === right.generation &&
		left.lease === right.lease
	)
}
