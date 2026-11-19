<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import WorkspaceSelector from '#lib/components/workspaces/WorkspaceSelector.svelte'
	import WorkspaceNameForm from '#lib/components/workspaces/WorkspaceNameForm.svelte'
	import WorkspaceCreation from '#lib/components/workspaces/WorkspaceCreation.svelte'
	import WorkspaceBackup from '#lib/components/workspaces/WorkspaceBackup.svelte'
	import { Heading } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const navigation = getPageNavigation()
	function fields(type: 'CHANGE' | 'SUBMIT', event: Event) {
		event.preventDefault()
		if (event.currentTarget instanceof HTMLFormElement)
			client.workspaceSettingsCommand(
				{ type, values: Object.fromEntries(new FormData(event.currentTarget)) },
				state.current
			)
	}
	function reset(event: Event) {
		event.preventDefault()
		client.workspaceSettingsCommand({ type: 'RESET' }, state.current)
	}
</script>

<svelte:head><title>{m['nouns.workspace']({ count: 1 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.workspace']({ count: 1 })} />{/snippet}
	<WorkspaceSelector
		organizations={state.current.workspaces ?? undefined}
		organizationId={state.current.selection.workspaceId}
		label={m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}
		onchange={client.navigateWorkspace}
	/>
	{#if state.current.selection.workspaceId && state.current.workspace}
		<Heading level="h2"
			>{m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })}</Heading
		>
		<WorkspaceNameForm
			name={state.current.workspace.row?.name ?? ''}
			defaultCurrency={state.current.workspace.row?.defaultCurrency ?? 'USD'}
			view={state.current.workspace.form}
			onsubmit={(event) => fields('SUBMIT', event)}
			oninput={(event) => fields('CHANGE', event)}
			onreset={reset}
			onRetryReadiness={() =>
				client.workspaceSettingsCommand({ type: 'RETRY_READINESS' }, state.current)}
		/>
		{#if state.current.backup}
			<WorkspaceBackup
				kind="download"
				view={state.current.backup}
				ondownload={(protection, password) =>
					client.startBackup(protection, password, state.current)}
				oncancel={() => client.backupCommand('CANCEL', state.current)}
				onreload={() => client.backupCommand('RELOAD', state.current)}
			/>
		{/if}
	{/if}
	{#if state.current.workspaceRestore}
		<WorkspaceBackup
			kind="restore"
			view={state.current.workspaceRestore}
			onrestore={(file, password) => client.startWorkspaceRestore(file, password, state.current)}
			oncommand={(command) => client.workspaceRestoreCommand(command, state.current)}
		/>
	{/if}
	<WorkspaceCreation />
</PageLayout>
