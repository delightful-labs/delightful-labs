<script lang="ts">
	import { get, writable } from 'svelte/store'
	import { Button, Text } from 'delightful-ui'
	import RecoveryPhrase from '../src/lib/integrations/identity/RecoveryPhrase.svelte'
	import { createRecoveryMessages } from '../src/lib/localization/recovery.js'
	import type {
		RecoveryPhraseCapability,
		RecoveryScope,
		RecoveryScopeSource
	} from '../src/lib/contracts/recovery-phrase.js'

	const scopes = writable<RecoveryScope>({
		kind: 'available',
		identityId: 'synthetic-host',
		binding: {},
		generation: 0
	})
	const events = $state<string[]>([])
	const counts = $state({ subscriptions: 0, releases: 0, reads: 0, settlements: 0 })
	let mounted = $state(true)
	let delay = $state(false)
	let complete: (() => void) | undefined
	let messages = $state(createRecoveryMessages('en'))

	function makeSource(): RecoveryScopeSource {
		return {
			subscribe(notify) {
				counts.subscriptions += 1
				events.push('subscribe')
				const unsubscribe = scopes.subscribe(notify)
				return () => {
					counts.releases += 1
					events.push('release')
					unsubscribe()
				}
			}
		}
	}

	function makeCapability(): RecoveryPhraseCapability {
		return {
			isCurrentScope(captured) {
				const current = get(scopes)
				return (
					current.kind === 'available' &&
					current.identityId === captured.identityId &&
					current.binding === captured.binding &&
					current.generation === captured.generation
				)
			},
			readPhrase() {
				counts.reads += 1
				const phrase = 'synthetic owned integration phrase — not a real credential'
				if (!delay) return Promise.resolve(phrase)
				return new Promise<string>((resolve) => {
					complete = () => {
						counts.settlements += 1
						resolve(phrase)
					}
				})
			}
		}
	}

	let source = $state.raw(makeSource())
	let capability = $state.raw(makeCapability())
</script>

<Button type="button" onclick={() => (source = makeSource())}>Replace source</Button>
<Button type="button" onclick={() => (capability = makeCapability())}>Replace capability</Button>
<Button type="button" onclick={() => (mounted = !mounted)}>Toggle composition</Button>
<Button type="button" onclick={() => (delay = true)}>Delay exports</Button>
<Button type="button" onclick={() => complete?.()}>Complete pending export</Button>
<Button type="button" onclick={() => scopes.set({ kind: 'unavailable' })}>Invalidate scope</Button>
<Button
	type="button"
	onclick={() => (messages = {
		...messages,
		heading: 'Updated recovery heading',
		close: 'Dismiss updated view'
	})}
>Change messages</Button>
<Button
	type="button"
	onclick={() => (source = {
		subscribe() { throw new Error('Synthetic private source detail') }
	})}
>Break source</Button>
<Text>
	Subscriptions: {counts.subscriptions}; releases: {counts.releases}; reads: {counts.reads};
	settlements: {counts.settlements}.
</Text>

<Text>Subscription events: {events.join(' → ')}.</Text>

<svelte:boundary>
	{#if mounted}
		<RecoveryPhrase {source} {capability} {messages} />
	{/if}
	{#snippet failed(error)}
		<Text>{error instanceof Error ? error.message : 'Recovery integration failed'}</Text>
	{/snippet}
</svelte:boundary>
