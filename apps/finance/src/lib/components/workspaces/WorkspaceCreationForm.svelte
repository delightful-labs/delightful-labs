<script lang="ts">
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import { WorkspaceCreationDialog } from 'delightful-local-first/workspace'
	import {
		workspaceCreationDialogPresentation,
		type WorkspaceCreationView
	} from '#lib/machines/workspaces/workspace-creation.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		scope,
		view,
		onSubmit,
		onRetry,
		onNew
	}: {
		scope: unknown
		view: WorkspaceCreationView
		onSubmit: (name: string) => void
		onRetry: () => void
		onNew: () => void
	} = $props()
	const presentation = $derived(workspaceCreationDialogPresentation(view))
	const descriptions = {
		unavailable: () => m['workspace.create_unavailable'](),
		working: () => m['workspace.create_working'](),
		editing: () => '',
		invalid: () =>
			m['forms.enter_subject']({
				subject: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })
			}),
		recovered: () => m['workspace.create_recovered'](),
		complete: () => m['status.saved_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		conflict: () => m['workspace.create_conflict'](),
		failed: () => m['workspace.create_failed'](),
		unresolved: () => m['workspace.create_unresolved']()
	}
	const message = $derived(descriptions[presentation.feedback.kind]())
	const dialogView = $derived({
		...presentation,
		feedback: {
			text: message,
			priority: presentation.feedback.priority,
			visible: presentation.feedback.visible
		}
	})
	const messages = $derived({
		heading: m['actions.create_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		nameLabel: m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) }),
		submit: m['actions.create_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		cancel: m['actions.cancel'](),
		close: m['actions.close'](),
		retry: m['actions.retry'](),
		createAnother: m['actions.create_another_subject']({
			subject: m['nouns.workspace']({ count: 1 })
		})
	})
</script>

<WorkspaceCreationDialog {scope} view={dialogView} {messages} {onSubmit} {onRetry} {onNew}>
	{#snippet completion()}
		{#if view.workspace}
			<p>
				<AppLink href="/" query={{ workspace: view.workspace.id }}
					>{m['actions.open_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}: {view
						.workspace.name}</AppLink
				>
			</p>
		{/if}
	{/snippet}
</WorkspaceCreationDialog>
