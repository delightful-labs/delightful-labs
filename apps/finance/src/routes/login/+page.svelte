<script lang="ts">
	import { fromStore } from 'svelte/store'
	import { getFinanceWorker } from '#lib/runtime/worker/context.js'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import LoginForm from '#lib/components/identity/LoginForm.svelte'
	import { m } from '#lib/paraglide/messages.js'
	const client = getFinanceWorker().client
	const state = fromStore(client.view)
	const navigation = getPageNavigation()
	const title = $derived(
		m['actions.restore_subject']({ subject: m['nouns.account']({ count: 1 }) })
	)
	function restore(event: SubmitEvent) {
		event.preventDefault()
		const form = event.currentTarget
		if (!(form instanceof HTMLFormElement)) return
		const phrase = new FormData(form).get('recoveryPhrase')
		if (typeof phrase === 'string') client.restoreIdentity(phrase)
		form.reset()
	}
</script>

<svelte:head><title>{title} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader {title} />{/snippet}
	<LoginForm
		canSubmit={state.current.identityRestore.canSubmit}
		restoring={state.current.identityRestore.busy}
		navigationOnly={state.current.identityRestore.navigationOnly}
		restoreError={state.current.identityRestore.error}
		sessionError={state.current.status === 'failed'}
		navigationError={state.current.identityRestore.navigationError}
		canRetryNavigation={state.current.identityRestore.canRetryNavigation}
		draftRevision={state.current.identityRestore.draftRevision}
		onRetryNavigation={client.retryRecoveryNavigation}
		onsubmit={restore}
	/>
</PageLayout>
