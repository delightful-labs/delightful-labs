<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import ProfileNameForm from '#lib/components/identity/ProfileNameForm.svelte'
	import ProfileAvatarForm from '#lib/components/identity/ProfileAvatarForm.svelte'
	import WorkerRecovery from '#lib/components/worker/WorkerRecovery.svelte'
	import type { WorkerFormCommand } from '#lib/contracts/worker-forms.js'
	import { m } from '#lib/paraglide/messages.js'
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const navigation = getPageNavigation()
	function send(form: 'name' | 'avatar', command: WorkerFormCommand) {
		client.profileCommand(form, command, state.current)
	}
	function fields(form: 'name' | 'avatar', type: 'CHANGE' | 'SUBMIT', event: Event) {
		event.preventDefault()
		if (event.currentTarget instanceof HTMLFormElement)
			send(form, { type, values: Object.fromEntries(new FormData(event.currentTarget)) })
	}
	function reset(form: 'name' | 'avatar', event: Event) {
		event.preventDefault()
		send(form, { type: 'RESET' })
	}
</script>

<svelte:head><title>{m['nouns.account']({ count: 1 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.account']({ count: 1 })} />{/snippet}
	<WorkerRecovery binding={client.recovery} />
	{#if state.current.profile}
		<ProfileNameForm
			profileId={state.current.profile.row?.id ?? ''}
			displayName={state.current.profile.row?.displayName}
			view={state.current.profile.forms.name}
			onsubmit={(event) => fields('name', 'SUBMIT', event)}
			oninput={(event) => fields('name', 'CHANGE', event)}
			onreset={(event) => reset('name', event)}
			onRetryReadiness={() => send('name', { type: 'RETRY_READINESS' })}
		/>
		<ProfileAvatarForm
			profileId={state.current.profile.row?.id ?? ''}
			avatarData={state.current.profile.row?.avatarData}
			mimeType={state.current.profile.row?.avatarMimeType}
			view={state.current.profile.forms.avatar}
			onsubmit={(event) => fields('avatar', 'SUBMIT', event)}
			oninput={(event) => fields('avatar', 'CHANGE', event)}
			onreset={(event) => reset('avatar', event)}
			onRetryReadiness={() => send('avatar', { type: 'RETRY_READINESS' })}
			onRemove={() => send('avatar', { type: 'SUBMIT', values: { action: 'remove' } })}
			onSelectionChange={(file) =>
				send('avatar', { type: 'CHANGE', values: { action: 'upload', file } })}
		/>
	{/if}
</PageLayout>
