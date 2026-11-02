<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import WorkspaceCreationDialogExample from './WorkspaceCreationDialogExample.svelte'
	const { Story } = defineMeta({
		title: 'Workspaces/Creation dialog', component: WorkspaceCreationDialogExample,
		parameters: { docs: { description: { component: 'Synthetic host only. Creation and recovery remain caller-owned; closing leaves the attempt running.' } } }
	})
</script>
<Story name="Editing" />
<Story name="Unavailable" args={{ unavailable: true }} />
<Story name="Independent instances" asChild>
	<WorkspaceCreationDialogExample />
	<WorkspaceCreationDialogExample heading="Create another workspace" />
</Story>
