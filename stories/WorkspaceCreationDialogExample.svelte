<script lang="ts">
	import { Button } from 'delightful-ui'
	import WorkspaceCreationDialog from '../src/lib/components/workspaces/WorkspaceCreationDialog.svelte'
	import type { WorkspaceCreationDialogView } from '../src/lib/contracts/workspace-creation-dialog.js'

	let { unavailable = false, heading = 'Create workspace' }: { unavailable?: boolean; heading?: string } = $props()
	let phase = $state<'editing' | 'working' | 'complete' | 'failed'>('editing')
	let scope = $state(0)
	let revision = $state(0)
	let translated = $state(false)
	let submitted = $state('')
	let retries = $state(0)
	let mounted = $state(true)
	let blocked = $state(false)
	const view: WorkspaceCreationDialogView = $derived({
		canOpen: !unavailable && !blocked,
		canSubmit: phase === 'editing',
		canRetry: phase === 'failed',
		canCreateAnother: phase === 'complete',
		fieldsEditable: phase === 'editing',
		activity: phase === 'working' ? 'working' : 'idle',
		content: phase === 'complete' ? 'complete' : 'fields',
		draftRevision: revision,
		attemptName: submitted,
		feedback: {
			text: phase === 'working' ? 'Creating workspace' : phase === 'failed' ? 'Creation failed' : phase === 'complete' ? 'Workspace saved' : '',
			priority: phase === 'failed' ? 'alert' : 'status'
		}
	})
	const messages = $derived({
		heading: translated ? 'Créer un espace' : heading,
		nameLabel: translated ? 'Nom de l’espace' : 'Workspace name',
		submit: translated ? 'Créer' : 'Create workspace',
		cancel: translated ? 'Annuler' : 'Cancel',
		close: translated ? 'Fermer' : 'Close',
		retry: 'Retry', createAnother: 'Create another workspace'
	})
	function fresh() { phase = 'editing'; submitted = ''; revision += 1 }
	// Synthetic host observations, including results arriving while the native modal is open.
	// No SDK, actual actor, storage or network operation is exercised by this story.
	function observe(command: unknown) {
		if (command === 'creation-demo:complete') phase = 'complete'
		if (command === 'creation-demo:fail') phase = 'failed'
		if (command === 'creation-demo:locale') translated = !translated
		if (command === 'creation-demo:scope') { scope += 1; fresh() }
		if (command === 'creation-demo:block') blocked = true
		if (command === 'creation-demo:unmount') mounted = false
	}
</script>

<svelte:window onmessage={(event) => { if (event.origin === window.location.origin && event.source === window) observe(event.data) }} />
{#if mounted}
	<WorkspaceCreationDialog {scope} {view} {messages}
		onSubmit={(name) => { submitted = name; phase = 'working' }}
		onRetry={() => { retries += 1; phase = 'working' }} onNew={fresh}>
		{#snippet completion()}<a href="#workspace-created">Open {submitted}</a>{/snippet}
	</WorkspaceCreationDialog>
{/if}
<p role="status" aria-label="Host attempt">{submitted}</p>
<p role="status" aria-label="Host phase">{phase}</p>
<p role="status" aria-label="Host retries">{retries}</p>
<Button type="button" onclick={() => observe('creation-demo:complete')}>Complete attempt</Button>
<Button type="button" onclick={() => observe('creation-demo:locale')}>Change wording</Button>
