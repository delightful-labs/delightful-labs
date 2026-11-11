import {
	createQuerySubscription,
	createQuerySubscriptionOne
} from 'delightful-local-first/backend/jazz/data'
// A Svelte-aware bundler must consume the built public view, without a source alias.
export { AccountRecovery } from 'delightful-local-first/recovery'
export { createRecoveryMessages } from 'delightful-local-first/recovery/messages'
export { default as RecoveryPhrase } from 'delightful-local-first/recovery/svelte'
export { WorkspaceSelector } from 'delightful-local-first/workspace'

export { WorkspaceCreationDialog } from 'delightful-local-first/workspace'

export { default as FormContent } from 'delightful-local-first/forms/content'
export { default as FormFeedback } from 'delightful-local-first/forms/feedback-view'
export { default as FormModal } from 'delightful-local-first/forms/modal'
export { default as ProfileNameForm } from 'delightful-local-first/profile/name-view'
export { default as Avatar } from 'delightful-local-first/profile/avatar-view'
export { default as ProfileAvatarForm } from 'delightful-local-first/profile/avatar-form'
export {
	createQuerySubscription,
	createQuerySubscriptionOne
} from 'delightful-local-first/backend/jazz/data'

export { encodeArchivePayload, parseArchivePayload } from 'delightful-local-first/backup/archive'

/** Compile-time consumer check; call only inside a component that owns native subscriptions. */
type NoteQuery = Exclude<
	Parameters<typeof createQuerySubscription<{ id: string; title: string }>>[0],
	undefined | (() => unknown)
>
export function subscribeToTypedNotes(query: NoteQuery) {
	const many = createQuerySubscription(query)
	const one = createQuerySubscriptionOne(() => query)
	const manyTitle: string | undefined = many.current?.[0]?.title
	const oneTitle: string | undefined = one.current?.title
	return { many, one, manyTitle, oneTitle }
}
