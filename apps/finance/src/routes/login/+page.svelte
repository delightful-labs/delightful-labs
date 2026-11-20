<script lang="ts">
	import { Button, InputText, StatusMessage, Dialog } from 'delightful-ui'
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
	const title = $derived(m['navigation.login']())
	const auth = $derived(state.current.auth)
	function signIn(event: SubmitEvent) {
		event.preventDefault()
		const form = event.currentTarget
		if (!(form instanceof HTMLFormElement)) return
		const handle = new FormData(form).get('handle')
		if (typeof handle === 'string') client.beginAuth(handle)
	}
	function restore(event: SubmitEvent) {
		event.preventDefault()
		const form = event.currentTarget
		if (!(form instanceof HTMLFormElement)) return
		const phrase = new FormData(form).get('recoveryPhrase')
		if (typeof phrase === 'string') client.restoreIdentity(phrase)
	}
</script>

<svelte:head><title>{title} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader {title} />{/snippet}
	<form onsubmit={signIn}>
		<InputText
			label={m['login.atproto_handle']()}
			name="handle"
			id="atproto-handle"
			required
			maxlength={2048}
			pattern=".*\S.*"
			disabled={auth?.busy || (!auth?.canBegin && !auth?.confirmationRequired)}
			readonly={auth?.confirmationRequired}
		/>
		<Button
			type="submit"
			disabled={!auth?.canBegin && !auth?.confirmationRequired}
			aria-disabled={auth?.confirmationRequired}>{m['login.atproto_sign_in']()}</Button
		>
	</form>
	<Dialog
		heading={m['login.atproto_sign_in']()}
		open={auth?.confirmationRequired ?? false}
		closedby="closerequest"
		onclose={() => {
			if (auth?.confirmationRequired) client.cancelAuth()
		}}
	>
		<p>{m['login.switch_notice']()}</p>
		<Button type="button" onclick={client.confirmAuth}>{m['login.continue_sign_in']()}</Button>
		<Button type="button" onclick={client.cancelAuth}>{m['actions.cancel']()}</Button>
	</Dialog>
	{#if auth?.message}
		<StatusMessage text={m[auth.message.key]()} variant={auth.message.variant} />
	{/if}
	{#if auth?.canRetryNavigation}
		<Button type="button" onclick={client.retryAuth}>{m['actions.retry']()}</Button>
	{/if}
	<LoginForm
		canSubmit={state.current.identityRestore.canSubmit}
		restoring={state.current.identityRestore.busy}
		navigationOnly={state.current.identityRestore.navigationOnly}
		restoreError={state.current.identityRestore.feedback === 'invalidPhrase'}
		sessionError={state.current.status === 'failed' ||
			state.current.identityRestore.feedback === 'sessionFailed'}
		navigationError={state.current.identityRestore.navigationError}
		canRetryNavigation={state.current.identityRestore.canRetryNavigation}
		draftRevision={state.current.identityRestore.draftRevision}
		onRetryNavigation={client.retryRecoveryNavigation}
		onsubmit={restore}
	/>
</PageLayout>
