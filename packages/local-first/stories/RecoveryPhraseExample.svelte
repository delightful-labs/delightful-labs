<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { fromStore, readable } from 'svelte/store'
	import { createActor } from 'xstate'
	import { Button } from 'delightful-ui'
	import AccountRecovery from '../src/lib/components/identity/RecoveryPhraseView.svelte'
	import { createRecoveryMessages } from '../src/lib/localization/recovery.js'
	import type { RecoveryMessages } from '../src/lib/contracts/recovery-messages.js'
	import type {
		AvailableRecoveryScope,
		RecoveryScope
	} from '../src/lib/contracts/recovery-phrase.js'
	import {
		createRecoveryPhraseMachine,
		selectRecoveryPhraseView
	} from '../src/lib/machines/identity/recovery-phrase.js'

	let {
		available = true,
		fail = false,
		withControls = false,
		messages = createRecoveryMessages('en')
	}: { available?: boolean; fail?: boolean; withControls?: boolean; messages?: RecoveryMessages } = $props()

	let mounted = $state(true)

	const scope: AvailableRecoveryScope = {
		kind: 'available',
		identityId: 'storybook-synthetic',
		binding: {},
		generation: 0
	}
	const currentScope = (): RecoveryScope =>
		available ? scope : { kind: 'unavailable' }
	const actor = createActor(
		createRecoveryPhraseMachine({
			isCurrentScope: (captured) => available && captured.binding === scope.binding,
			readPhrase: async () => {
				if (fail) throw new Error('Synthetic recovery failure')
				return 'storybook demonstration only — this is not a real recovery phrase'
			}
		}),
		{ input: untrack(currentScope) }
	)
	const snapshot = fromStore(
		readable(actor.getSnapshot(), (set) => {
			const subscription = actor.subscribe(set)
			return () => subscription.unsubscribe()
		})
	)
	const view = $derived(selectRecoveryPhraseView(snapshot.current))

	$effect(() => actor.send({ type: 'OBSERVE', scope: currentScope() }))
	onMount(() => {
		actor.start()
		return () => {
			actor.send({ type: 'SHUTDOWN' })
			actor.stop()
		}
	})
</script>

{#if withControls}
	<Button type="button" onclick={() => (available = !available)}>Toggle availability</Button>
	<Button type="button" onclick={() => (mounted = !mounted)}>Toggle recovery view</Button>
	<Button
		type="button"
		onclick={() => (messages = {
			...messages,
			heading: 'Demo account recovery',
			close: 'Dismiss demo'
		})}
	>Change wording</Button>
	<Button type="button" onclick={() => (fail = false)}>Allow recovery</Button>
{/if}

{#if mounted}
	<AccountRecovery
		{view}
		{messages}
		onReveal={() => actor.send({ type: 'REVEAL' })}
		onRetry={() => actor.send({ type: 'RETRY' })}
		onHide={() => {
			if (actor.getSnapshot().status === 'active') actor.send({ type: 'HIDE' })
		}}
	/>
{/if}
