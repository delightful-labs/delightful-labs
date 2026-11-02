<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import WorkspaceSelectorExample from './WorkspaceSelectorExample.svelte'
	const { Story } = defineMeta({
		title: 'Workspaces/Selector', component: WorkspaceSelectorExample,
		parameters: { docs: { description: { component: 'Local synthetic directory only. The host applies explicit requests; the view never selects or opens a client.' } } }
	})
</script>

<Story name="Multiple choices" />
<Story name="Sole unselected workspace" args={{ scenario: 'single' }} />
<Story name="Duplicate names" args={{ scenario: 'duplicates' }} />
<Story name="Empty directory" args={{ scenario: 'empty' }} />
<Story name="Unavailable directory" args={{ scenario: 'unavailable' }} />
<Story name="Independent instances" asChild>
	<WorkspaceSelectorExample />
	<WorkspaceSelectorExample label="Other workspace" />
</Story>
