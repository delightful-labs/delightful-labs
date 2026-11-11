<script lang="ts">
	import { WorkspaceSelector as SharedWorkspaceSelector } from 'delightful-local-first/workspace'
	import { createWorkspaceSelectorView } from 'delightful-local-first/workspace/presentation'
	import type { Organization } from '#lib/schema.js'
	import { workspaceLabel } from '#lib/domain/workspace-routes.js'
	import { m } from '#lib/paraglide/messages.js'

	let {
		organizations,
		organizationId,
		label = m['labels.current_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		onchange
	}: {
		organizations: readonly Pick<Organization, 'id' | 'name'>[] | undefined
		organizationId: string | null
		label?: string
		onchange: (organizationId: string) => void
	} = $props()
	const view = $derived(
		createWorkspaceSelectorView({
			directory:
				organizations === undefined
					? { status: 'unavailable' }
					: { status: 'available', entries: organizations },
			workspaceId: organizationId,
			duplicateName: (name, id) => workspaceLabel({ name, id }, organizations ?? [])
		})
	)
	const messages = $derived({
		label,
		placeholder: m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		empty: m['workspace.empty']()
	})
</script>

<SharedWorkspaceSelector {view} {messages} onSelect={onchange} />
