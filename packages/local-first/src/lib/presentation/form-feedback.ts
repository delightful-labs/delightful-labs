export type {
	FeedbackMessage,
	FormFeedbackInput,
	FormFeedbackDescriptor,
	FormFeedbackMessages
} from '../contracts/scoped-form.js'

import type {
	FeedbackMessage,
	FormFeedbackDescriptor,
	FormFeedbackInput,
	FormFeedbackMessages
} from '../contracts/scoped-form.js'

/** Translate the message selected by the workflow; never choose a workflow outcome here. */
export function formatFormFeedback<Result, Reason>(
	descriptor: FormFeedbackDescriptor,
	input: FormFeedbackInput<Result, Reason>,
	defaults: FormFeedbackMessages
): readonly FeedbackMessage[] {
	const status = (text: string): readonly FeedbackMessage[] => [{ text, role: 'status' }]
	const alert = (text: string): readonly FeedbackMessage[] => [{ text, role: 'alert' }]
	if (descriptor.message === 'loading') return status(defaults.loading({ subject: input.subject }))
	if (descriptor.message === 'loadFailed')
		return alert(defaults.loadFailed({ subject: input.subject }))
	if (descriptor.message === 'completionFailed') return alert(defaults.completionFailed())
	if (descriptor.message === 'unknown') return alert(input.messages.unknown ?? defaults.unknown())
	if (descriptor.message === 'interruptedSaved')
		return status(input.messages.interruptedSaved ?? defaults.interruptedSaved())
	if (descriptor.message === 'settling')
		return status(input.messages.settling ?? defaults.settling())
	if (descriptor.message === 'operationFailed')
		return alert(
			input.action === 'archive'
				? defaults.archiveFailed({ subject: input.subject })
				: defaults.saveFailed({ subject: input.subject })
		)
	if (descriptor.message === 'invalid')
		return input.validationMessages.length
			? [{ paragraphs: input.validationMessages, role: 'alert' }]
			: []
	if (descriptor.message === 'readinessBlocked')
		return input.view.readiness.kind === 'blocked'
			? [
					{
						text: input.reasonText(input.view.readiness.reason),
						role: input.blockedRole(input.view.readiness.reason)
					}
				]
			: []
	const feedback = input.view.feedback
	if (descriptor.message === 'saved')
		return status(
			feedback.kind === 'result' && feedback.result.outcome === 'succeeded' && input.successMessage
				? input.successMessage(feedback.result.value)
				: defaults.saved({ subject: input.subject })
		)
	if (
		descriptor.message === 'blocked' &&
		feedback.kind === 'result' &&
		(feedback.result.outcome === 'denied' || feedback.result.outcome === 'unavailable')
	)
		return alert(input.reasonText(feedback.result.reason))
	return []
}
