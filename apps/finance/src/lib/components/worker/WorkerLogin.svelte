<script lang="ts">
	import LoginForm from '../identity/LoginForm.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import type { FinanceWorkerView } from '../../contracts/worker-application.js'
	let {
		view,
		onRestore,
		onRetryNavigation
	}: {
		view: FinanceWorkerView
		onRestore: (phrase: string) => void
		onRetryNavigation: () => void
	} = $props()
	function submit(event: SubmitEvent) {
		event.preventDefault()
		const form = event.currentTarget
		if (!(form instanceof HTMLFormElement)) return
		const phrase = new FormData(form).get('recoveryPhrase')
		if (typeof phrase === 'string') onRestore(phrase)
	}
</script>

<details>
	<summary>{m['navigation.login']()}</summary>
	<LoginForm
		canSubmit={view.identityRestore.canSubmit}
		restoring={view.identityRestore.busy}
		restoreError={view.identityRestore.feedback === 'invalidPhrase'}
		sessionError={view.status === 'failed' || view.identityRestore.feedback === 'sessionFailed'}
		draftRevision={view.identityRestore.draftRevision}
		navigationOnly={view.identityRestore.navigationOnly}
		navigationError={view.identityRestore.navigationError}
		canRetryNavigation={view.identityRestore.canRetryNavigation}
		{onRetryNavigation}
		onsubmit={submit}
	/>
</details>
