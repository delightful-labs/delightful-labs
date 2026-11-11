import { getContext } from 'svelte'
import type {
	WorkspaceCoordinatorActor,
	selectWorkspaceView
} from '../machines/runtime/readiness.js'

export type WorkspaceContext = {
	readonly actor: WorkspaceCoordinatorActor | undefined
	readonly view: ReturnType<typeof selectWorkspaceView>
}
export const workspaceKey = Symbol('workspace')
export function getWorkspace() {
	return getContext<WorkspaceContext>(workspaceKey)
}
