/** SDK-, actor-, schema- and localization-free operation/view protocols.
 * Consumer feedback rendering may decorate these views without becoming a shared workflow input.
 */
export type FormIssue = { path: readonly PropertyKey[]; code: string; message?: string }
export type FormSettlement =
	| 'notStarted'
	| 'locallyPersisted'
	| 'confirmed'
	| 'rejected'
	| 'unknown'
export type FormInterruption = 'scopeChanged' | 'cancelled' | 'closed'
export type FormReadiness<Reason> = { kind: 'ready' } | { kind: 'blocked'; reason: Reason }
/** Opaque domain-owned recovery data; consumers must validate it before reuse. */
export type FormRecovery = { checkpoint?: unknown }
export type FormOperationResult<Result, Reason> = FormRecovery &
	(
		| { outcome: 'succeeded'; value: Result; settlement: 'locallyPersisted' | 'confirmed' }
		| { outcome: 'denied' | 'unavailable'; reason: Reason; settlement: 'notStarted' }
		| { outcome: FormInterruption; settlement: FormSettlement }
		| {
				outcome: 'failed'
				code:
					| 'validationFailed'
					| 'operationFailed'
					| 'availabilityFailed'
					| 'unexpected'
					| 'completionFailed'
				settlement: FormSettlement
		  }
		| {
				outcome: 'partial'
				value: Result
				reason: Reason
				settlement: 'locallyPersisted' | 'confirmed' | 'unknown'
		  }
	)
export type FormResult<Result, Reason> =
	| FormOperationResult<Result, Reason>
	| (FormRecovery & { outcome: 'invalid'; issues: readonly FormIssue[]; settlement: 'notStarted' })
export type ScopedFormView<Result, Reason> = {
	readiness: FormReadiness<Reason> | { kind: 'observing' | 'failed' | 'closed' }
	content: { kind: 'fields' } | { kind: 'success'; value: Result }
	activity:
		| { kind: 'idle' | 'validating' | 'operating' }
		| { kind: 'settling'; reason: FormInterruption }
	feedback: { kind: 'none' } | { kind: 'result'; result: FormResult<Result, Reason> }
	canSubmit: boolean
	canReset: boolean
	canOpen: boolean
	canCancel: boolean
	fieldsEditable: boolean
	canRetryReadiness: boolean
	draftRevision: number
}
/** Shared rendering surface for form components. */
export type FormPresentation = Pick<
	ScopedFormView<unknown, unknown>,
	'activity' | 'content' | 'canSubmit' | 'canReset' | 'canOpen' | 'fieldsEditable' | 'draftRevision'
>

/** Revision is assigned by the owner; domain availability must echo it. */
export type FormObservation<Observation> = { revision: number; facts: Observation }
export type FormCapability<Scope, Reason> = {
	revision: number
	scope: Scope
	readiness: FormReadiness<Reason>
}
/** Public adapter protocols; the actor binding is carried by the invocation recipient. */
export type FormCapabilityReportEvent<Scope, Reason> = {
	type: 'FORM_CAPABILITY_REPORTED'
	generation: number
	capability: FormCapability<Scope, Reason>
}
export type FormAssessmentToken = {
	requestId: number
	scopeRevision: number
	generation: number
}
export type FormReadinessResult<Scope, Reason> =
	| { kind: 'assessed'; token: FormAssessmentToken; capability: FormCapability<Scope, Reason> }
	| { kind: 'failed'; token?: FormAssessmentToken }
export type FormRequest<Scope> = FormRecovery & {
	id: number
	scope: Scope
	scopeRevision: number
	values: unknown
}
/** Submission-owned progress, scoped to one request and its original scope lifetime. */
export type FormSubmissionProgressEvent = {
	type: 'FORM_SUBMISSION_PROGRESS'
	requestId: number
	scopeRevision: number
	progress: 'validating' | 'operating'
}
export type FormChildEvent<Observation> =
	| { type: 'OBSERVE'; observation: FormObservation<Observation> }
	| { type: 'INVALIDATE' | 'CANCEL' | 'SHUTDOWN' }
export type FormOperationInput<Values, Scope, Observation> = {
	request: Omit<FormRequest<Scope>, 'values'> & { values: Values }
	observation: FormObservation<Observation>
}

/** Creation accepts drafts as before; editing requires a domain baseline comparison. */
export type FormMode<Values, Observation> =
	| { mode?: 'create' }
	| {
			mode: 'edit'
			initialValues: (observation: Observation) => Values
			valuesEqual: (draft: unknown, initialValues: Values) => boolean
	  }

/** Interruption changes the outcome without discarding domain recovery data. */
export function formInterruptionResult<Result, Reason>(
	outcome: FormInterruption,
	result: FormResult<Result, Reason> | undefined
): FormOperationResult<Result, Reason> {
	return {
		outcome,
		settlement: result?.settlement ?? 'unknown',
		...(result?.checkpoint === undefined ? {} : { checkpoint: result.checkpoint })
	}
}
