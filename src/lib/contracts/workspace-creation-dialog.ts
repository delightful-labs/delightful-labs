/** Presentation selected by the creation owner; none of these capabilities grant access. */
export type WorkspaceCreationDialogView = Readonly<{
	canOpen: boolean
	canSubmit: boolean
	canRetry: boolean
	canCreateAnother: boolean
	fieldsEditable: boolean
	activity: 'idle' | 'working'
	content: 'fields' | 'complete'
	/** Change only when the workflow requests a fresh draft, not on locale updates. */
	draftRevision: string | number
	/** A retained attempt name, distinct from the editable draft. */
	attemptName: string
	feedback: Readonly<{
		text: string
		priority: 'status' | 'alert'
		/** Announcements stay mounted even when the host omits duplicate visible progress. */
		visible?: boolean
	}>
}>

/** Supplied by the consumer's localization boundary, with no English fallback. */
export type WorkspaceCreationDialogMessages = Readonly<{
	heading: string
	nameLabel: string
	submit: string
	cancel: string
	close: string
	retry: string
	createAnother: string
}>
