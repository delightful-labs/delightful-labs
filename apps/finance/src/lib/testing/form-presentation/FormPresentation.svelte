<script lang="ts">
	import FormContent from '../../components/forms/FormContent.svelte'
	import FormModal from '../../components/forms/FormModal.svelte'
	import { createScopedFormController } from '../../forms/forms.svelte.js'
	import type { FormOperationResult } from '../../contracts/form-contract.js'
	import { harnessOptions, type Facts } from './form-presentation.js'

	const modal = new URLSearchParams(location.search).has('modal')
	const delayedValidation = new URLSearchParams(location.search).has('validation')
	let finishValidation: (() => void) | undefined
	let facts = $state<Facts>({ scope: 'a', allowed: true })
	let starts = $state(0)
	let cancellations = $state(0)
	let completion: ((result: FormOperationResult<void, string>) => void) | undefined
	const form = createScopedFormController(
		harnessOptions({
			observe: () => facts,
			...(delayedValidation
				? {
						validate: () => {
							const pending = Promise.withResolvers<void>()
							finishValidation = pending.resolve
							return pending.promise
						}
					}
				: {}),
			start: () => {
				starts += 1
				const pending = Promise.withResolvers<FormOperationResult<void, string>>()
				completion = pending.resolve
				return pending.promise
			},
			command: (event) => {
				if (event.type === 'CANCEL' || event.type === 'SHUTDOWN') cancellations += 1
			}
		})
	)
	function finish() {
		completion?.({ outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' })
		completion = undefined
	}
</script>

{#if delayedValidation}<button onclick={() => finishValidation?.()}>Finish validation</button>{/if}

<!-- Test-only controls expose observations and settlement, never a production route. -->
<button onclick={() => (facts = { ...facts, allowed: !facts.allowed })}>Toggle access</button>
<button onclick={() => (facts = { ...facts, publish: false })}>Hold readiness</button>
<button onclick={() => (facts = { ...facts, publish: true })}>Release readiness</button>
<button onclick={() => (facts = { ...facts, broken: true })}>Fail readiness</button>
<button onclick={() => (facts = { ...facts, broken: false })}>Repair readiness</button>
<button onclick={form.retryReadiness} disabled={!form.view.canRetryReadiness}
	>Retry readiness</button
>
<p data-testid="readiness">{form.view.readiness.kind}</p>
<button onclick={() => (facts = { ...facts, scope: facts.scope === 'a' ? 'b' : 'a' })}
	>Replace scope</button
>
<button onclick={() => form.reset(new Event('reset', { cancelable: true }))}>Request reset</button>
<button onclick={finish}>Finish write</button>
<p data-testid="starts">{starts}</p>
<p data-testid="cancellations">{cancellations}</p>
<p data-testid="activity">{form.view.activity.kind}</p>
<p data-testid="revision">{form.view.draftRevision}</p>

{#snippet fields()}
	<label>Name <input name="name" required /></label>
{/snippet}
{#snippet feedback(view: typeof form.view)}
	{#if view.feedback.kind === 'result'}
		<p role="status">{view.feedback.result.outcome}</p>
	{/if}
{/snippet}
{#if modal}
	<FormModal
		scope={facts.scope}
		label="Save draft"
		view={form.view}
		onopen={form.open}
		onsubmit={form.submit}
		onreset={form.reset}
		{fields}
		{feedback}
	/>
{:else}
	<FormContent view={form.view} onsubmit={form.submit} onreset={form.reset} {fields} {feedback}>
		{#snippet controls(view)}
			<button type="submit" disabled={!view.canSubmit}>Save draft</button>
			<button type="reset" disabled={!view.canReset}>Reset draft</button>
		{/snippet}
	</FormContent>
{/if}
