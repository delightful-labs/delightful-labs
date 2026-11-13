import type { WorkflowMessage } from '../../contracts/feedback.js'
import type { LibraryClient } from './client.js'
import type { LibraryRender } from './views.js'
import type { Observer } from 'xstate'

/** Observes one client without owning it. Key consumers by client when its scope changes. */
export function libraryViewSource(client: LibraryClient) {
	return {
		getSnapshot: () => client.getView(),
		subscribe: (observer: Observer<LibraryRender> | ((view: LibraryRender) => void)) =>
			client.subscribe((view) => {
				if (typeof observer === 'function') observer(view)
				else observer.next?.(view)
			})
	}
}

export function sameWorkflowMessage(
	previous: WorkflowMessage | undefined,
	next: WorkflowMessage | undefined
) {
	return previous?.text === next?.text && previous?.variant === next?.variant
}
