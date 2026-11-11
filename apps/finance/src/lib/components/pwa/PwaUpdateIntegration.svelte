<script lang="ts">
	import { inspectActor } from '#lib/diagnostics/inspector.js'
	import { onMount } from 'svelte'
	import { dev } from '$app/env'
	import { createActor } from 'xstate'
	import PwaUpdateNotice from './PwaUpdateNotice.svelte'
	import {
		createPwaUpdateMachine,
		selectPwaUpdateView,
		type PwaUpdateView
	} from '#lib/machines/pwa/pwa-update.js'

	let view = $state<PwaUpdateView>('hidden')
	let accept = () => {}
	let later = () => {}

	onMount(() => {
		if (dev || !('serviceWorker' in navigator)) return
		const initialController = navigator.serviceWorker.controller
		const actor = createActor(
			createPwaUpdateMachine({
				registration: () => navigator.serviceWorker.ready,
				controller: () => navigator.serviceWorker.controller,
				reload: () => window.location.reload(),
				observe: (registration, send) => {
					const workers = new Set<ServiceWorker>()
					let controller = initialController
					const inspect = () => {
						try {
							if (registration.waiting && navigator.serviceWorker.controller) {
								send({ type: 'READY', worker: registration.waiting })
							}
							const installing = registration.installing
							if (installing && !workers.has(installing)) {
								workers.add(installing)
								installing.addEventListener('statechange', inspect)
							}
						} catch {
							send({ type: 'OBSERVER_FAILED' })
						}
					}
					const changed = () => {
						const next = navigator.serviceWorker.controller
						if (controller && next && next !== controller) send({ type: 'ACTIVATED' })
						controller = next
					}
					registration.addEventListener('updatefound', inspect)
					navigator.serviceWorker.addEventListener('controllerchange', changed)
					changed()
					inspect()
					return () => {
						registration.removeEventListener('updatefound', inspect)
						navigator.serviceWorker.removeEventListener('controllerchange', changed)
						for (const worker of workers) worker.removeEventListener('statechange', inspect)
					}
				}
			}),
			{ inspect: inspectActor }
		)
		const subscription = actor.subscribe((snapshot) => (view = selectPwaUpdateView(snapshot)))
		accept = () => actor.send({ type: view === 'failed' ? 'RETRY' : 'ACCEPT' })
		later = () => actor.send({ type: 'LATER' })
		actor.start()
		return () => {
			actor.send({ type: 'SHUTDOWN' })
			subscription.unsubscribe()
			actor.stop()
		}
	})
</script>

<PwaUpdateNotice {view} onUpdate={() => accept()} onLater={() => later()} />
