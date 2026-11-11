import type { z } from 'zod'
import {
	createScopedFormMachine as createSharedForm,
	type ScopedFormOptions as SharedOptions
} from 'delightful-local-first/forms/workflow'
import type { FormOperationResult } from '#lib/contracts/form-contract.js'
import { formDependencies } from '#lib/forms/form-dependencies.js'
import type { Snapshot } from 'xstate'

export { selectScopedFormView } from 'delightful-local-first/forms/workflow'
export type ScopedFormOptions<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
> = SharedOptions<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot,
	OperationSnapshot
> & { schema: z.ZodType<Values> }
export function createScopedFormMachine<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
>(
	options: ScopedFormOptions<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		OperationSnapshot
	>
) {
	return createSharedForm<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		OperationSnapshot
	>(options, formDependencies)
}
