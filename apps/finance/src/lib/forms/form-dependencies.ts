import { z } from 'zod'
import { m } from '#lib/paraglide/messages.js'
import type { ScopedFormDependencies } from 'delightful-local-first/forms/workflow'
export const formDependencies: ScopedFormDependencies = {
	validationIssues: (error) =>
		error instanceof z.ZodError
			? error.issues.map(({ path, code, message }) => ({ path, code, message }))
			: undefined,
	messages: {
		unknown: () => m['forms.unknown'](),
		loading: (input) => m['status.loading_subject'](input),
		loadFailed: (input) => m['errors.load_subject'](input),
		saved: (input) => m['status.saved_subject'](input),
		completionFailed: () => m['forms.completion_failed'](),
		interruptedSaved: () => m['forms.interrupted_saved'](),
		archiveFailed: (input) => m['errors.archive_subject'](input),
		saveFailed: (input) => m['errors.save_subject'](input),
		settling: () => m['forms.settling']()
	}
}
