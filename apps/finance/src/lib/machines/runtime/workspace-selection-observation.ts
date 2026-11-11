import type {
	WorkspaceSelectionObservation,
	WorkspaceSelectionRequest,
	WorkspaceSelectionScope
} from 'delightful-local-first/workspace/contracts'
import type { ReadinessObservation } from './readiness.js'
import { workspaceRoute } from '../../domain/workspace-routes.js'

/** Intent is URL-owned; the directory is never authorization evidence. */
export function workspaceSelectionTarget(observation: ReadinessObservation) {
	const route = workspaceRoute(observation.route.search)
	return route.scoped && route.workspaceId === observation.source.organizationId
		? route.workspaceId
		: undefined
}

/** Map local facts only. Selection, suspension and resource ownership remain in their actors. */
export function workspaceSelectionObservation(
	facts: ReadinessObservation,
	scope: WorkspaceSelectionScope,
	request: WorkspaceSelectionRequest,
	generation: number
): WorkspaceSelectionObservation {
	const member = facts.source.membership
	const access =
		facts.sessionStatus !== 'ready' || !facts.source.userId
			? 'unavailable'
			: facts.membershipError != null
				? 'failed'
				: facts.membershipLoading || !member
					? 'unknown'
					: member.userId !== facts.source.userId || member.organizationId !== request.workspaceId
						? 'denied'
						: 'allowed'
	return {
		scope,
		request,
		generation,
		access,
		directory:
			facts.organizationsError != null
				? { status: 'failed' }
				: facts.organizationsLoading
					? { status: 'loading' }
					: facts.organizations === undefined
						? { status: 'unavailable' }
						: {
								status: 'available',
								entries: facts.organizations.map(({ id, name }) => ({ id, name }))
							}
	}
}
