<script lang="ts">
	import { Button } from 'delightful-ui'
	import WorkspaceSelector from '../src/lib/components/workspaces/WorkspaceSelector.svelte'
	import { createWorkspaceSelectorView } from '../src/lib/presentation/workspace-selector.js'
	import type { WorkspaceDirectory } from '../src/lib/contracts/workspace-selection.js'

	let { scenario = 'multiple', label = 'Current workspace' }: {
		scenario?: 'single' | 'multiple' | 'duplicates' | 'empty' | 'unavailable'
		label?: string
	} = $props()
	let selected = $state<string | null>(null)
	let requested = $state('')
	let blocked = $state(false)
	let translated = $state(false)
	const instanceId = $props.id()
	const hintId = `${instanceId}-hint`
	const directory: WorkspaceDirectory = $derived(
		scenario === 'unavailable' ? { status: 'loading' } : {
			status: 'available', entries: scenario === 'empty' ? [] : scenario === 'single'
				? [{ id: 'first', name: 'Personal' }] : [
					{ id: 'first', name: scenario === 'duplicates' ? 'Ledger' : 'Personal' },
					{ id: 'second', name: scenario === 'duplicates' ? 'Ledger' : 'Shared' }
				]
		}
	)
	const view = $derived(createWorkspaceSelectorView({
		directory, workspaceId: selected, disabled: blocked,
		duplicateName: (name, id) => translated ? `${id} — ${name}` : `${name} [${id}]`
	}))
	const messages = $derived({
		label: translated ? 'Espace actuel' : label,
		placeholder: translated ? 'Choisir un espace' : 'Select workspace',
		empty: translated ? 'Aucun espace' : 'No workspaces yet'
	})
</script>

<p id={hintId}>Available on this device.</p>
<WorkspaceSelector {view} {messages} name="workspace" aria-describedby={hintId} onSelect={(id) => (requested = id)} />
<p role="status" aria-label="Requested workspace">{requested}</p>
<Button type="button" onclick={() => (selected = requested || null)}>Apply selection</Button>
<Button type="button" onclick={() => (blocked = !blocked)}>Toggle interaction</Button>
<Button type="button" onclick={() => (translated = !translated)}>Change wording</Button>
