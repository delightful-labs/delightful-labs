import { createCallbackLogic } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import {
	selectLibraryActor,
	selectLibraryCommandBinding,
	selectRecoveryBinding
} from '../../machines/runtime/application-readiness.js'
import type { ApplicationSnapshot } from '../../machines/runtime/application-readiness.js'
import type { libraryMachine } from '../../machines/capture/library.js'
import type { tagFormMachine } from '../../machines/capture/tag-form.js'
import type { RecoveryBinding } from '../../contracts/account.js'
import type { RecoveryOwner } from './recovery-owner.js'
import type { WorkspaceLibraryBinding } from '../../machines/runtime/workspace-library.js'

type Observable = {
	subscribe(observer: { next: () => void; error: () => void }): { unsubscribe: () => void }
}
type Library = ActorRefFrom<typeof libraryMachine>
export type ApplicationBindingFacts = {
	library: Library | undefined
	recovery: RecoveryBinding | undefined
	commands: WorkspaceLibraryBinding | undefined
}
export function applicationBindingFacts(snapshot: ApplicationSnapshot): ApplicationBindingFacts {
	return {
		library: selectLibraryActor(snapshot),
		recovery: selectRecoveryBinding(snapshot),
		commands: selectLibraryCommandBinding(snapshot)
	}
}
export function sameApplicationBinding(
	left: ApplicationBindingFacts,
	right: ApplicationBindingFacts
) {
	return (
		left.library === right.library &&
		left.commands?.owner === right.commands?.owner &&
		left.commands?.lease === right.commands?.lease &&
		left.recovery?.capability === right.recovery?.capability &&
		left.recovery?.source === right.recovery?.source
	)
}
export function libraryBindingFacts(library: Library) {
	const snapshot = library.getSnapshot()
	return {
		library,
		active:
			snapshot.matches({ running: { control: 'active' } }) &&
			snapshot.context.capability?.isCurrent() === true,
		documentId:
			snapshot.context.reader?.kind === 'available'
				? snapshot.context.reader.document.id
				: undefined,
		tags: Object.fromEntries(snapshot.context.rows.map((row) => [row.id, row.tags]))
	}
}
/** Native subscriptions only. The host selects the binding and consumes these
 * facts; publication never adopts resources or scans reader internals. */
export const bindingObservation = createCallbackLogic<
	never,
	{
		library: Library | undefined
		tagForm: ActorRefFrom<typeof tagFormMachine> | undefined
		recovery: RecoveryOwner | undefined
		generation: number
	}
>(({ input, sendBack }) => {
	let disposed = false
	const update = () => {
		if (disposed) return
		if (input.library)
			sendBack({
				type: 'LIBRARY_OBSERVED',
				generation: input.generation,
				facts: libraryBindingFacts(input.library)
			})
		else sendBack({ type: 'RENDER' })
	}
	const roots: Observable[] = [input.library, input.tagForm, input.recovery].filter(
		(ref) => ref !== undefined
	)
	const subscriptions = roots.map((root) =>
		root.subscribe({
			next: update,
			error: () => sendBack({ type: 'BINDING_FAILED', generation: input.generation })
		})
	)
	update()
	return () => {
		disposed = true
		for (const subscription of subscriptions) subscription.unsubscribe()
	}
})
