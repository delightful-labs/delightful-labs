import { m } from '#lib/paraglide/messages.js'
/** Presentation-only localization shared by the domain form views. */
export const formReasonText = {
	checkRetained: () => m['transactions.check_retained'](),
	saveUnresolved: () => m['transactions.save_unresolved'](),
	attachmentsFailed: () => m['images.transaction_upload_failed'](),
	linkedTransferRequiresUnlink: () => m['forms.linked_transfer_requires_unlink'](),
	sessionUnavailable: () => m['forms.session_unavailable'](),
	selectWorkspace: () =>
		m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
	loading: () => m['status.loading'](),
	loadFailed: () => m['forms.load_failed'](),
	readOnly: () => m['forms.read_only'](),
	unavailableReference: () => m['forms.unavailable_reference'](),
	ambiguousTagName: () => m['tags.ambiguous_name'](),
	duplicateName: () => m['forms.duplicate_name'](),
	protectedRecord: () => m['forms.protected_record'](),
	profileUnavailable: () => m['forms.profile_unavailable'](),
	noAccounts: () => m['transactions.no_accounts'](),
	noCategories: () => m['forms.no_categories']()
}

import type { FormFeedbackMessages } from 'delightful-local-first/forms/feedback'
export const formMessages: FormFeedbackMessages = {
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
