<script lang="ts">
	import LoginForm from '../identity/LoginForm.svelte'
	import { m } from '#lib/paraglide/messages.js'
	import type { FinanceWorkerView } from '../../contracts/worker-application.js'
	let { view, onRestore }: { view: FinanceWorkerView; onRestore: (phrase: string) => void } =
		$props()
	function submit(event: SubmitEvent) {
		event.preventDefault()
		const form = event.currentTarget
		if (!(form instanceof HTMLFormElement)) return
		const phrase = new FormData(form).get('recoveryPhrase')
		if (typeof phrase === 'string') onRestore(phrase)
		form.reset()
	}
</script>

<details>
	<summary>{m['navigation.login']()}</summary>
	<LoginForm
		canSubmit={view.identityRestore.canSubmit}
		restoring={view.identityRestore.busy}
		restoreError={view.identityRestore.error}
		sessionError={view.status === 'failed'}
		draftRevision={view.identityRestore.draftRevision}
		navigationOnly={false}
		navigationError={false}
		canRetryNavigation={false}
		onRetryNavigation={() => {}}
		onsubmit={submit}
	/>
</details>
