import type { ScopedFormView } from '../../contracts/scoped-form.js'
export type FeedbackMessage =
	| { text: string; role: 'status' | 'alert' }
	| { paragraphs: readonly string[]; role: 'alert' }
export type FormFeedbackInput<Result, Reason> = {
	view: Omit<ScopedFormView<Result, Reason>, 'feedbackLabels'>
	subject: string
	reasonText: (reason: Reason) => string
	validationMessages: readonly string[]
	successMessage: { invoke(value: Result): string }['invoke'] | undefined
	action: 'save' | 'archive'
	messages: {
		sessionUnavailable?: string
		settling?: string
		scopeChanged?: string
		cancelled?: string
		closed?: string
		interruptedSaved?: string
		unknown?: string
	}
	blockedRole: (reason: Reason) => 'alert' | 'status'
}

export type FormFeedbackLabel<Result, Reason> = {
	section: 'readiness' | 'result'
	label(input: FormFeedbackInput<Result, Reason>): readonly FeedbackMessage[]
}
