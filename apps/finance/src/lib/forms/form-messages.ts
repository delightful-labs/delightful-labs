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
