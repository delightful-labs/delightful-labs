<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { getJazzSession } from 'jazz-tools/svelte'
	import { fromStore } from 'svelte/store'
	import { page } from '$app/state'
	import { getReadiness } from '#lib/runtime/bank-sync.js'
	import { selectRecoveryView } from '#lib/machines/runtime/application-readiness.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import LoginForm from '#lib/components/identity/LoginForm.svelte'

	const session = getJazzSession()
	const snapshot = fromStore(session)

	const readiness = getReadiness()
	const application = fromStore(readiness.snapshot)
	const recovery = $derived(selectRecoveryView(application.current))
	function restoreAccount(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		readiness.actor.send({
			type: 'RECOVER',
			phrase: String(new FormData(event.currentTarget).get('recoveryPhrase') ?? ''),
			origin: `${page.url.pathname}${page.url.search}${page.url.hash}`,
			destination: '/'
		})
	}
</script>

<svelte:head
	><title
		>{m['actions.restore_subject']({ subject: m['nouns.account']({ count: 1 }) })} · {m[
			'app.name'
		]()}</title
	></svelte:head
>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader
			title={m['actions.restore_subject']({ subject: m['nouns.account']({ count: 1 }) })}
		/>{/snippet}

	<LoginForm
		restoring={recovery.busy}
		navigationOnly={recovery.navigationOnly}
		restoreError={recovery.invalid}
		sessionError={recovery.failed || Boolean(snapshot.current.error)}
		navigationError={recovery.navigationFailed}
		canRetryNavigation={recovery.canRetryNavigation}
		draftRevision={recovery.draftRevision}
		onRetryNavigation={() => readiness.actor.send({ type: 'RETRY_NAVIGATION' })}
		onsubmit={restoreAccount}
	/>
</PageLayout>
