import type { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormMode,
	FormObservation,
	FormOperationResult,
	FormOperationInput
} from '#lib/contracts/form-contract.js'
import type { FormPersistence } from './scoped-form-write.js'
import { createSingleWriteFormOptions as createSharedOptions } from 'delightful-local-first/forms/policy'
import type { ScopedFormOptions } from './scoped-form.js'
import type { ActorLogic, Snapshot, SnapshotFrom } from 'xstate'

/** Composition only: policy states and effects are supplied by the domain. */
export function createSingleWriteFormOptions<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	AvailabilitySnapshot extends Snapshot<unknown>,
	PersistenceSnapshot extends Snapshot<FormOperationResult<Result, Reason>> = Snapshot<
		FormOperationResult<Result, Reason>
	>
>(
	options: {
		schema: z.ZodType<Values>
		availability: ActorLogic<
			AvailabilitySnapshot,
			FormChildEvent<Observation>,
			FormObservation<Observation>
		>
		selectAvailability: (snapshot: AvailabilitySnapshot) => FormCapability<Scope, Reason>
		scopeOf: (facts: Observation) => Scope
		sameScope: (left: Scope, right: Scope) => boolean
		observe: () => Observation
		classifyBlocked: (reason: Reason) => 'denied' | 'unavailable'
		assessmentObservation?: (input: FormOperationInput<Values, Scope, Observation>) => Observation
		successContent?: 'retain' | 'replace'
		resetOnSuccess?: boolean
	} & FormMode<Values, Observation> &
		FormPersistence<Values, Result, Reason, Scope, Observation, PersistenceSnapshot>
) {
	return createSharedOptions<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		PersistenceSnapshot,
		z.ZodType<Values>
	>({ ...options, settlement: 'locallyPersisted' })
}
