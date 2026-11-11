import type { ScopedFormView as SharedScopedFormView } from 'delightful-local-first/forms/contracts'
import type { FormFeedbackLabel } from '../machines/forms/form-feedback.js'

export { formInterruptionResult } from 'delightful-local-first/forms/contracts'
export type {
	FormIssue,
	FormSettlement,
	FormInterruption,
	FormReadiness,
	FormRecovery,
	FormOperationResult,
	FormResult,
	FormPresentation,
	FormObservation,
	FormCapability,
	FormCapabilityReportEvent,
	FormAssessmentToken,
	FormReadinessResult,
	FormRequest,
	FormSubmissionProgressEvent,
	FormChildEvent,
	FormOperationInput,
	FormMode
} from 'delightful-local-first/forms/contracts'

/** Finance owns translated feedback callbacks; the shared view owns only typed presentation facts. */
export type ScopedFormView<Result, Reason> = SharedScopedFormView<Result, Reason> & {
	feedbackLabels?: readonly FormFeedbackLabel<Result, Reason>[]
}
