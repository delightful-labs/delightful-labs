<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { fromStore, readable } from 'svelte/store'
	import { createActor } from 'xstate'
	import type {
		RecoveryPhraseCapability,
		RecoveryScopeSource
	} from '../../contracts/recovery-phrase.js'
	import type { RecoveryMessages } from '../../contracts/recovery-messages.js'
	import {
		createRecoveryPhraseMachine,
		selectRecoveryPhraseView
	} from '../../machines/identity/recovery-phrase.js'
	import AccountRecovery from '../../components/identity/RecoveryPhraseView.svelte'

	let { source, capability, messages }: {
		source: RecoveryScopeSource
		capability: RecoveryPhraseCapability
		messages: RecoveryMessages
	} = $props()

	// This component owns exactly one immutable dependency pair; its parent keys replacements.
	const dependencies = untrack(() => ({ source, capability }))
	const actor = createActor(createRecoveryPhraseMachine(dependencies.capability), {
		input: { kind: 'unavailable' }
	})
	const snapshot = fromStore(
		readable(actor.getSnapshot(), (set) => {
			const subscription = actor.subscribe(set)
			return () => subscription.unsubscribe()
		})
	)
	const view = $derived(selectRecoveryPhraseView(snapshot.current))

	onMount(() => {
		actor.start()
		try {
			const unsubscribe = dependencies.source.subscribe((scope) => {
				actor.send({ type: 'OBSERVE', scope })
			})
			return () => {
				actor.send({ type: 'SHUTDOWN' })
				try {
					unsubscribe()
				} finally {
					actor.stop()
				}
			}
		} catch {
			actor.send({ type: 'SHUTDOWN' })
			actor.stop()
			throw new Error('Recovery scope subscription failed')
		}
	})
</script>

<AccountRecovery
	{view}
	{messages}
	onReveal={() => actor.send({ type: 'REVEAL' })}
	onRetry={() => actor.send({ type: 'RETRY' })}
	onHide={() => {
		if (actor.getSnapshot().status === 'active') actor.send({ type: 'HIDE' })
	}}
/>
