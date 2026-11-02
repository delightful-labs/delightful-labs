import { onMount, untrack } from 'svelte'
import { stopAfterShutdown } from '../../machines/forms/lifecycle.js'
import { createActor, type Snapshot, type InspectionEvent } from 'xstate'
import {
	createScopedFormMachine,
	selectScopedFormView,
	type ScopedFormDependencies,
	type ScopedFormOptions
} from '../../machines/forms/scoped-form.js'
import type { FormOperationResult } from '../../contracts/scoped-form.js'

type OperationValue<S extends Snapshot<unknown>> =
	Extract<S['output'], { outcome: 'succeeded' }> extends { value: infer Value } ? Value : never

/** Each integration owns one exact dependency binding until shutdown settles. */
export function createScopedFormController<
	Values,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>,
	Result = OperationValue<OperationSnapshot>
>(
	options: ScopedFormOptions<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		OperationSnapshot
	> & {
		observe: () => Observation
		arrayFields?: () => readonly string[]
		dependencies: ScopedFormDependencies
		inspect?: (event: InspectionEvent) => void
	}
) {
	const bound = untrack(() => options)
	const actor = untrack(() =>
		createActor(
			createScopedFormMachine<
				Values,
				Result,
				Reason,
				Scope,
				Observation,
				AvailabilitySnapshot,
				OperationSnapshot
			>(bound, bound.dependencies),
			{ input: bound.observe(), ...(bound.inspect ? { inspect: bound.inspect } : {}) }
		)
	)
	let formSnapshot = $state.raw(actor.getSnapshot())
	const view = $derived(
		selectScopedFormView<
			Values,
			Result,
			Reason,
			Scope,
			Observation,
			AvailabilitySnapshot,
			OperationSnapshot
		>(formSnapshot, bound)
	)
	$effect(() => {
		const observation = bound.observe()
		untrack(() => actor.send({ type: 'OBSERVE', observation }))
	})
	onMount(() => {
		const subscription = actor.subscribe({
			next: (snapshot) => {
				formSnapshot = snapshot
			},
			error: () => {
				formSnapshot = actor.getSnapshot()
			}
		})
		actor.start()
		return () => {
			subscription.unsubscribe()
			stopAfterShutdown(actor)
		}
	})
	function formValues(form: HTMLFormElement) {
		const data = new FormData(form)
		const arrays = Object.fromEntries(
			(bound.arrayFields?.() ?? []).map((name) => [name, data.getAll(name)])
		)
		return { ...Object.fromEntries(data), ...arrays }
	}
	function submitValues(values: unknown) {
		actor.send({ type: 'OBSERVE', observation: bound.observe() })
		actor.send({ type: 'SUBMIT', values })
	}
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitValues(formValues(event.currentTarget))
	}
	function changeValues(values: unknown) {
		actor.send({ type: 'OBSERVE', observation: bound.observe() })
		actor.send({ type: 'CHANGE', values })
	}
	function input(event: Event) {
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		changeValues(formValues(event.currentTarget))
	}

	function reset(event: Event) {
		event.preventDefault()
		// Presentation keys fields by draftRevision; rejected RESET must leave native fields intact.
		actor.send({ type: 'RESET' })
	}
	return {
		input,
		changeValues,
		submitValues,
		submit,
		reset,
		open: () => actor.send({ type: 'OPEN' }),
		cancel: () => actor.send({ type: 'CANCEL' }),
		retryReadiness: () => actor.send({ type: 'RETRY_READINESS' }),
		get view() {
			return view
		}
	}
}
