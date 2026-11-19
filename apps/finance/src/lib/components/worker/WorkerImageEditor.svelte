<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { createActor } from 'xstate'
	import { Dialog } from 'delightful-ui'
	import ImageEditor from '../image-editor/ImageEditor.svelte'
	import { imageEditorMachine } from '../../machines/images/image-editor.js'
	import { financeImageEditorCancel } from '../../contracts/worker-images.js'
	import { stopAfterShutdown } from '../../runtime/actor-lifecycle.js'
	import { m } from '../../paraglide/messages.js'
	let { file, port, onfinish }: { file: File; port: MessagePort; onfinish: () => void } = $props()
	const actor = untrack(() =>
		createActor(imageEditorMachine, { input: { file, mode: 'perspective' } })
	)
	onMount(() => {
		const subscription = actor.subscribe({
			next: (snapshot) => {
				if (snapshot.status !== 'done') return
				port.postMessage(snapshot.output)
				onfinish()
			},
			error: () => {
				port.postMessage({ kind: 'failed', reason: 'input' })
				onfinish()
			}
		})
		port.onmessage = (event) => {
			const command = financeImageEditorCancel.safeParse(event.data)
			if (command.success) actor.send(command.data)
		}
		port.onmessageerror = () => actor.send({ type: 'SHUTDOWN' })
		actor.start()
		return () => {
			subscription.unsubscribe()
			stopAfterShutdown(actor)
			port.close()
		}
	})
</script>

<Dialog
	heading={m['actions.edit_subject']({ subject: m['nouns.image']({ count: 1 }) })}
	open
	closedby="any"
	onclose={() => actor.send({ type: 'CANCEL' })}
	oninput={(event) => event.stopPropagation()}
>
	<ImageEditor {file} {actor} />
</Dialog>
