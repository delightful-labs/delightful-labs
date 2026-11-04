import { onMount, untrack } from 'svelte'
import { createActor } from 'xstate'
import {
	createAvatarSelectionMachine,
	selectAvatarSelection,
	type AvatarCropRequest,
	type AvatarSelectionObservation
} from '../../machines/identity/avatar-selection.js'

/** Component-lifetime root binding; workflow decisions belong to the selection chart. */
export function createAvatarSelection(options: {
	observe: () => AvatarSelectionObservation
	validateFile: (file: File) => boolean
	onSelectionChange: (file: File | null) => void
	onRemove: () => void
}) {
	const actor = untrack(() =>
		createActor(createAvatarSelectionMachine(options), { input: options.observe() })
	)
	let snapshot = $state.raw(actor.getSnapshot())
	const view = $derived(selectAvatarSelection(snapshot))
	$effect(() => {
		const observation = options.observe()
		untrack(() => actor.send({ type: 'OBSERVE', observation }))
	})
	onMount(() => {
		const subscription = actor.subscribe((value) => {
			snapshot = value
		})
		actor.start()
		return () => {
			actor.send({ type: 'SHUTDOWN' })
			subscription.unsubscribe()
			actor.stop()
		}
	})
	return {
		get view() {
			return view
		},
		select: (file: File | null) => actor.send({ type: 'SELECT', file }),
		edit: (file: File) => actor.send({ type: 'EDIT', file }),
		accept: (crop: AvatarCropRequest, file: File) => actor.send({ type: 'ACCEPT', crop, file }),
		dismiss: (crop: AvatarCropRequest) => actor.send({ type: 'DISMISS', crop })
	}
}
