import { createScopedFormController as createSharedController } from 'delightful-local-first/forms/svelte'
import { inspectActor } from '#lib/diagnostics/inspector.js'
import { formDependencies } from './form-dependencies.js'
import type { ScopedFormOptions } from '#lib/machines/forms/scoped-form.js'
import type { FormOperationResult } from '#lib/contracts/form-contract.js'
import type { Snapshot } from 'xstate'

type OperationValue<S extends Snapshot<unknown>> =
	Extract<S['output'], { outcome: 'succeeded' }> extends { value: infer Value } ? Value : never
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
	}
) {
	return createSharedController<
		Values,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		OperationSnapshot,
		Result
	>({ ...options, dependencies: formDependencies, inspect: inspectActor })
}
