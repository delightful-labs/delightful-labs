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
export { QuerySubscription, QuerySubscriptionOne } from 'delightful-local-first/backend/jazz/data'
