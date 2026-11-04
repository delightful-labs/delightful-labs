// Resolve declarations through package exports, never through src/lib or a source alias.
import * as foundation from 'delightful-local-first'

export const publicEntryPoint: object = foundation

export type {
	AvailableRecoveryScope,
	RecoveryScope,
	RecoveryPhraseCapability,
	RecoveryPhraseEvent,
	RecoveryPhraseView
} from 'delightful-local-first/recovery'
export {
	createRecoveryPhraseMachine,
	selectRecoveryPhraseView
} from 'delightful-local-first/recovery/workflow'

export { AccountRecovery } from 'delightful-local-first/recovery'
export { createRecoveryMessages } from 'delightful-local-first/recovery/messages'
export type { RecoveryMessages } from 'delightful-local-first/recovery/messages'

export { default as RecoveryPhrase } from 'delightful-local-first/recovery/svelte'
export { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
export type { RecoveryScopeSource } from 'delightful-local-first/recovery/contracts'

export { createRestorationMachine } from 'delightful-local-first/restoration/workflow'
export type { RestorationInput } from 'delightful-local-first/restoration/workflow'
export type {
	RestorationCapability,
	RestorationEvent,
	RestorationIdentity,
	RestorationReport,
	RestorationResult,
	RestorationScope
} from 'delightful-local-first/restoration/contracts'
export { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'

export { restorationMachine } from 'delightful-local-first/restoration/workflow'
export type { SuppliedRestorationInput } from 'delightful-local-first/restoration/workflow'

export {
	createSessionAcquisitionMachine,
	createSessionStartupMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
export type {
	SessionOwnerEvent,
	SessionOwnerInput,
	SessionOwnerRef,
	SessionStartupInput,
	SessionStartupEvent
} from 'delightful-local-first/session/workflow'
export type {
	SessionScope,
	SessionFailure,
	SessionOpenCapability,
	SessionOwnerReply,
	SessionStartupReport,
	SessionStartupOutput
} from 'delightful-local-first/session/contracts'
export { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'

export { createSessionReadinessMachine } from 'delightful-local-first/session/workflow'
export type {
	SessionReadinessInput,
	SessionReadinessEvent
} from 'delightful-local-first/session/workflow'
export type {
	SessionStatus,
	SessionReadinessScope,
	SessionReadinessCapability,
	SessionReadinessBinding,
	SessionReadinessReport,
	SessionObservationFailure
} from 'delightful-local-first/session/contracts'
export { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'

export {
	createWorkspaceSelectionMachine,
	selectWorkspaceLease
} from 'delightful-local-first/workspace/workflow'
export type { WorkspaceSelectionInput } from 'delightful-local-first/workspace/workflow'
export type {
	WorkspaceSelectionScope,
	WorkspaceSelectionRequest,
	WorkspaceDirectory,
	WorkspaceSelectionObservation,
	WorkspaceLease,
	WorkspaceDrainRequest,
	WorkspaceSelectionEvent,
	WorkspaceSelectionReport,
	WorkspaceSelectionOutput
} from 'delightful-local-first/workspace/contracts'

export { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
export type {
	WorkspaceCreationAttempt,
	WorkspaceCreationAssessment,
	WorkspaceCreationSettlement,
	WorkspaceCreationOutcome,
	WorkspaceCreationResult,
	WorkspaceCreationEvent,
	WorkspaceCreationTransactionCapability
} from 'delightful-local-first/workspace/creation/contracts'

export type {
	WorkspaceSelectorMessages,
	WorkspaceSelectorView
} from 'delightful-local-first/workspace'
export { createWorkspaceSelectorView } from 'delightful-local-first/workspace/presentation'
export type { WorkspaceSelectorInput } from 'delightful-local-first/workspace/presentation'

export type {
	WorkspaceCreationDialogView,
	WorkspaceCreationDialogMessages
} from 'delightful-local-first/workspace'

export { createWorkspaceNamingOperation } from 'delightful-local-first/workspace/naming/workflow'
export type {
	WorkspaceNamingRequest,
	WorkspaceNamingAssessment,
	WorkspaceNamingSettlement,
	WorkspaceNamingOutcome,
	WorkspaceNamingResult,
	WorkspaceNamingEvent,
	WorkspaceNamingCapability
} from 'delightful-local-first/workspace/naming/contracts'

export { createScopedFormReadinessMachine } from 'delightful-local-first/forms/readiness'
export { formInterruptionResult } from 'delightful-local-first/forms/contracts'
export type {
	ScopedFormAvailabilityLogic,
	ScopedFormReadinessDelivery,
	ScopedFormReadinessInput
} from 'delightful-local-first/forms/readiness'
export type {
	FormIssue,
	FormSettlement,
	FormInterruption,
	FormReadiness,
	FormRecovery,
	FormOperationResult,
	FormResult,
	ScopedFormView,
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

export { createScopedFormSubmissionMachine } from 'delightful-local-first/forms/submission'
export type {
	ScopedFormSubmissionInput,
	ScopedFormOperationLogic
} from 'delightful-local-first/forms/submission'
export type { FormSchema } from 'delightful-local-first/forms/contracts'

export {
	createScopedFormMachine,
	selectScopedFormView
} from 'delightful-local-first/forms/workflow'
export { createScopedFormWriteMachine } from 'delightful-local-first/forms/write'
export { createSingleWriteFormOptions } from 'delightful-local-first/forms/policy'
export { createScopedFormController } from 'delightful-local-first/forms/svelte'
export { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
export { createWorkspaceInitialization } from 'delightful-local-first/workspace/initialization'
export { createWorkspaceStartupMachine } from 'delightful-local-first/workspace/startup'
export { createWorkspaceJournal } from 'delightful-local-first/workspace/journal'
export { createWorkspaceCreationOwner } from 'delightful-local-first/workspace/creation-owner'
export { createWorkspaceCreationOperation } from 'delightful-local-first/workspace/creation-operation'
export { createWorkspacePersistence } from 'delightful-local-first/workspace/creation-persistence'
export { createProfileFormOptions } from 'delightful-local-first/profile/workflow'
export { createProfileAvatarMachine } from 'delightful-local-first/profile/avatar'
export { sessionRecoveryMachine } from 'delightful-local-first/recovery/coordination'
export { observeRow, observeRows } from 'delightful-local-first/data/observations'

export { createJazzStartupRegistry } from 'delightful-local-first/backend/jazz/startup'

export { createInvitationRedemptionMachine } from 'delightful-local-first/workspace/invitations/workflow'
export type {
	InvitationCapability,
	InvitationDecision,
	InvitationEvent,
	InvitationIdentity,
	InvitationReadiness,
	InvitationRequest,
	InvitationResult,
	InvitationSettlement
} from 'delightful-local-first/workspace/invitations/contracts'

export { createJazzInvitationAuthority } from 'delightful-local-first/backend/jazz/invitation-authority'
export type {
	InvitationAuthorityAdmission,
	InvitationAuthorityTransactions
} from 'delightful-local-first/workspace/invitations/authority-contracts'

export { createInvitationAuthorityMachine } from 'delightful-local-first/workspace/invitations/authority-workflow'
export type {
	InvitationAuthorityCapability,
	InvitationAuthorityRequest,
	InvitationAuthorityRecords,
	InvitationAuthorityObservation,
	InvitationAuthorityPlan,
	InvitationAuthorityResult,
	InvitationAuthoritySettlement,
	InvitationAuthorityEvent
} from 'delightful-local-first/workspace/invitations/authority-contracts'

export { createLogger } from 'delightful-local-first/diagnostics/logger'
export type {
	DebugValue,
	LogDetails,
	LogSink,
	Logger,
	LoggerOptions
} from 'delightful-local-first/diagnostics/logger'

export {
	encodeArchivePayload,
	parseArchivePayload,
	createArchivePayloadError,
	isArchivePayloadError
} from 'delightful-local-first/backup/archive'
export type {
	ArchivePayload,
	ArchiveRecord,
	ArchiveValue,
	ArchiveAttachment,
	PayloadLimitOverrides
} from 'delightful-local-first/backup/archive'

export { prepareArchiveSeal, prepareArchiveOpen } from 'delightful-local-first/backup/envelope'
export type {
	ArchiveEnvelopeRequest,
	ArchiveEnvelopeResult,
	IntegrityCheckedArchive,
	SealedArchive
} from 'delightful-local-first/backup/envelope'
export { createArchiveEnvelopeMachine } from 'delightful-local-first/backup/envelope/workflow'

export { prepareArchiveInspection } from 'delightful-local-first/backup/inspection'
export type {
	ArchiveInspectionRequest,
	ArchiveInspectionResult,
	ArchiveProfileValidator
} from 'delightful-local-first/backup/inspection'
export { createArchiveInspectionMachine } from 'delightful-local-first/backup/inspection/workflow'

export { zodFormIssues } from 'delightful-local-first/forms/zod'
