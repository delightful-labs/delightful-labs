import type { ActorRef, Snapshot } from 'xstate'
export type WorkspaceSessionFacts = {
	userId: string | undefined
	status: 'ready' | 'signed-out' | 'transitioning' | 'error' | 'closed'
}
export type InitializationRequest = WorkspaceSessionFacts & { generation: number }
export type InitializationStatus =
	| { kind: 'waiting' | 'checking' | 'failed' | 'closed' }
	| { kind: 'ready'; profileId: string }
export type InitializationReport = { request: InitializationRequest; status: InitializationStatus }
export type InitializationStatusEvent = {
	type: 'INITIALIZATION_STATUS'
	report: InitializationReport
}
export type InitializationRecipient = ActorRef<Snapshot<unknown>, InitializationStatusEvent>
export function sameInitializationRequest(
	currentRequest: InitializationRequest,
	incomingRequest: InitializationRequest
) {
	return (
		currentRequest.generation === incomingRequest.generation &&
		currentRequest.userId === incomingRequest.userId &&
		currentRequest.status === incomingRequest.status
	)
}
