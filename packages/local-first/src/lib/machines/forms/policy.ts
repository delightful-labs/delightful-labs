import { type Snapshot, type SnapshotFrom } from 'xstate'

import type { ScopedFormAvailabilityLogic } from './readiness.js'
import type {
	FormCapability,
	FormSchema,
	FormMode,
	FormOperationResult,
	FormOperationInput
} from '../../contracts/scoped-form.js'
import { createScopedFormWriteMachine, type FormPersistence } from './write.js'
import type { ScopedFormOptions } from './scoped-form.js'
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
	>,
	Schema extends FormSchema<Values> = FormSchema<Values>
>(
	options: {
		schema: Schema
		/** The write promise must settle only after this guarantee is met; mutation return is insufficient. */
		settlement: 'locallyPersisted' | 'confirmed'
		availability: ScopedFormAvailabilityLogic<AvailabilitySnapshot, Observation>
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
	const operation = createScopedFormWriteMachine<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		PersistenceSnapshot
	>(options)
	const { write: _write, persistence: _persistence, ...formOptions } = options
	return { ...formOptions, operation } satisfies ScopedFormOptions<
		Values,
		Result,
		Reason,
		Scope,
		Observation,
		AvailabilitySnapshot,
		SnapshotFrom<typeof operation>
	> & {
		observe: () => Observation
	}
}
