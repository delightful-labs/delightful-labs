import { TRANSACTION_SOURCE } from '#lib/domain/transaction-source.js'
import { PAYMENT_METHOD } from '#lib/domain/payment-method.js'
import { ORGANIZATION_ROLE } from '#lib/domain/organization-role.js'
import { EXPENSE, transactionPages } from '#lib/domain/transaction-kind.js'
import { createTransactionSubmissionMachine } from './transaction-submission.js'
import type { TransactionSaveDb } from './transaction-save.js'
import { transferEditRequiresUnlink } from '#lib/contracts/transaction-save-contract.js'
import { workspaceHref } from '../../domain/workspace-routes.js'
import { parseAmountMinor } from '#lib/domain/money.js'
import { normalizedName } from '#lib/domain/names.js'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation
} from '#lib/contracts/form-contract.js'
import type {
	TransactionEntryObservation,
	TransactionEntryReason,
	TransactionEntryScope
} from '#lib/contracts/transaction-entry-contract.js'
import { canWriteAccount } from '#lib/domain/organization-permissions.js'
import { createSingleWriteFormOptions } from '../forms/scoped-form-policy.js'
import {
	independentTransactionFormSchema,
	type TransactionSaveValues
} from '#lib/validation/transactions.js'
import type { AppTransaction, IncomePaymentMethod } from '#lib/domain/transaction.js'
import { z } from 'zod'
import { validateAttachmentSelection } from '#lib/domain/transaction-attachments.js'
import { setup, types } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export function transactionEntryScope(f: TransactionEntryObservation): TransactionEntryScope {
	return {
		identityId: f.identityId,
		organizationId: f.organizationId,
		binding: f.binding,
		kind: f.kind,
		...(f.transactionId === undefined ? {} : { transactionId: f.transactionId })
	}
}
export function sameTransactionEntryScope(a: TransactionEntryScope, b: TransactionEntryScope) {
	return (
		a.identityId === b.identityId &&
		a.organizationId === b.organizationId &&
		a.binding === b.binding &&
		a.kind === b.kind &&
		a.transactionId === b.transactionId
	)
}
export function writableTransactionAccounts(
	f: Pick<
		TransactionEntryObservation,
		'accounts' | 'organizationId' | 'membership' | 'identityId' | 'grants'
	>
) {
	return f.accounts.filter(
		(a) =>
			a.organizationId === f.organizationId &&
			a.archivedAt === null &&
			f.membership?.userId === f.identityId &&
			canWriteAccount(f.membership, f.organizationId, a.id, f.grants)
	)
}
export function applicableTransactionCategories(
	f: Pick<TransactionEntryObservation, 'categories' | 'organizationId' | 'kind'>
) {
	return f.categories.filter(
		(c) => c.organizationId === f.organizationId && c.kind === f.kind && c.archivedAt === null
	)
}
export function applicableTransactionTags(f: TransactionEntryObservation) {
	return f.tags.filter(
		(tag) =>
			tag.organizationId === f.organizationId && tag.kind === f.kind && tag.archivedAt === null
	)
}
export function createTransactionEntryAvailability(binding: object) {
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<TransactionEntryObservation>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<{ observation: FormObservation<TransactionEntryObservation> }>(),
			events: events0,
			input: types<FormObservation<TransactionEntryObservation>>()
		}
	}).createMachine({
		initial: 'checking',
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: (args) => {
				return { target: '.checking', context: { observation: args.event.observation } }
			}
		},
		states: {
			checking: {
				always: (args) => {
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => !f.sessionReady || !f.identityId || f.binding !== binding)(args)
					) {
						return { target: 'sessionUnavailable' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => !f.organizationId)(args)
					) {
						return { target: 'selectWorkspace' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => f.failed)(args)
					) {
						return { target: 'loadFailed' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => f.loading)(args)
					) {
						return { target: 'loading' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							f.membership?.userId !== f.identityId ||
							f.membership?.organizationId !== f.organizationId ||
							f.membership?.role === ORGANIZATION_ROLE.VIEWER)(args)
					) {
						return { target: 'readOnly' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							!f.accounts.some(
								(a) => a.organizationId === f.organizationId && a.archivedAt === null
							))(args)
					) {
						return { target: 'noAccounts' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => writableTransactionAccounts(f).length === 0)(args)
					) {
						return { target: 'readOnly' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => applicableTransactionCategories(f).length === 0)(args)
					) {
						return { target: 'noCategories' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							(f.transactionId !== undefined && !f.transaction) ||
							(f.intent !== undefined && !validTransactionReferences(f, f.intent)) ||
							(f.transaction !== undefined &&
								f.transaction !== null &&
								(!validTransactionReferences(f, transactionAsInput(f.transaction)) ||
									(f.transaction.source === TRANSACTION_SOURCE.SIMPLEFIN &&
										!f.transaction.externalId?.trim()) ||
									f.transaction.organizationId !== f.organizationId ||
									f.transaction.id !== f.transactionId ||
									(f.transaction.paymentMethod === PAYMENT_METHOD.CHECK && !f.transaction.check))))(
							args
						)
					) {
						return { target: 'unavailableReference' }
					}
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) => f.intent !== undefined && transferEditRequiresUnlink(f.transaction, f.intent))(
							args
						)
					) {
						return { target: 'linkedTransferRequiresUnlink' }
					}
					return { target: 'checkingTags' }
				}
			},
			checkingTags: {
				always: (args) => {
					if (
						(({
							context: {
								observation: { facts: f }
							}
						}) =>
							(f.intent?.tags ?? []).some(
								(name) =>
									!f.transaction?.tags?.some(
										(link) => link.tag && normalizedName(link.tag.name) === normalizedName(name)
									) &&
									applicableTransactionTags(f).filter(
										(tag) => normalizedName(tag.name) === normalizedName(name)
									).length > 1
							))(args)
					) {
						return { target: 'ambiguousTagName' }
					}
					return { target: 'ready' }
				}
			},
			ambiguousTagName: {},
			sessionUnavailable: {},
			selectWorkspace: {},
			loadFailed: {},
			loading: {},
			readOnly: {},
			noAccounts: {},
			noCategories: {},
			unavailableReference: {},
			linkedTransferRequiresUnlink: {},
			ready: {}
		}
	})
}
export function selectTransactionEntryAvailability(
	s: SnapshotFrom<ReturnType<typeof createTransactionEntryAvailability>>
): FormCapability<TransactionEntryScope, TransactionEntryReason> {
	const { revision, facts } = s.context.observation
	const state = s.value
	if (state === 'checking' || state === 'checkingTags')
		throw new Error('Unassessed transaction entry')
	return {
		revision,
		scope: transactionEntryScope(facts),
		readiness: state === 'ready' ? { kind: 'ready' } : { kind: 'blocked', reason: state }
	}
}
type TransactionFormPolicyDependencies = {
	binding: object
	observe: () => TransactionEntryObservation
}
function transactionFormPolicy(deps: TransactionFormPolicyDependencies) {
	const availability = createTransactionEntryAvailability(deps.binding)
	const common = {
		availability,
		selectAvailability: selectTransactionEntryAvailability,
		scopeOf: transactionEntryScope,
		sameScope: sameTransactionEntryScope,
		observe: deps.observe,
		classifyBlocked: (reason: TransactionEntryReason): 'denied' | 'unavailable' =>
			reason === 'readOnly' ? 'denied' : 'unavailable'
	}
	const schema = independentTransactionFormSchema(() => deps.observe())
	return { common, schema }
}

function withAttachmentSelectionValidation(
	schema: ReturnType<typeof independentTransactionFormSchema>,
	observe: () => TransactionEntryObservation
) {
	return z.preprocess((input, ctx) => {
		if (!isFormRecord(input)) return input
		const { attachments, ...values } = input
		const selected = (Array.isArray(attachments) ? attachments : []).filter(
			(file) =>
				!(
					typeof File !== 'undefined' &&
					file instanceof File &&
					file.name === '' &&
					file.size === 0
				)
		)
		const files = selected.filter(
			(file): file is File => typeof File !== 'undefined' && file instanceof File
		)
		if (files.length !== selected.length) {
			ctx.addIssue({ code: 'custom', path: ['attachments'], message: 'invalidSelection' })
			return z.NEVER
		}
		const selection = validateAttachmentSelection(
			files,
			observe().transaction?.attachments?.length ?? 0
		)
		if (selection.kind !== 'accepted') {
			ctx.addIssue({ code: 'custom', path: ['attachments'], message: selection.kind })
			return z.NEVER
		}
		return values
	}, schema)
}

function isFormRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function createTransactionEntryFormOptions(
	deps: TransactionFormPolicyDependencies & {
		db: TransactionSaveDb
		getAttachments?: () => readonly File[]
		navigate?: (destination: string, signal: AbortSignal) => Promise<void>
	}
) {
	const { common, schema } = transactionFormPolicy(deps)
	const availability = common.availability
	const persistence = createTransactionSubmissionMachine(
		deps.db,
		deps.observe,
		deps.getAttachments ?? (() => [])
	)
	const options = createSingleWriteFormOptions<
		TransactionSaveValues,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof persistence>
	>({
		...common,
		schema: withAttachmentSelectionValidation(schema, deps.observe),
		mode: 'create',
		successContent: 'replace',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: request.values
		}),
		persistence
	})
	const navigate = deps.navigate
	return navigate
		? {
				...options,
				complete: (scope: TransactionEntryScope, signal: AbortSignal) =>
					navigate(workspaceHref(scope.organizationId, transactionPages[scope.kind].path), signal)
			}
		: options
}

export function createTransactionEditFormOptions(
	deps: TransactionFormPolicyDependencies & {
		db: TransactionSaveDb
		getAttachments?: () => readonly File[]
	}
) {
	const { common, schema } = transactionFormPolicy(deps)
	const availability = common.availability
	const persistence = createTransactionSubmissionMachine(
		deps.db,
		deps.observe,
		deps.getAttachments ?? (() => [])
	)
	return createSingleWriteFormOptions<
		TransactionSaveValues,
		void,
		TransactionEntryReason,
		TransactionEntryScope,
		TransactionEntryObservation,
		SnapshotFrom<typeof availability>,
		SnapshotFrom<typeof persistence>
	>({
		...common,
		schema: withAttachmentSelectionValidation(schema, deps.observe),
		mode: 'edit',
		initialValues: (facts) => {
			const initial = facts.transaction ? transactionAsInput(facts.transaction) : undefined
			if (!initial) throw new Error('Missing transaction')
			return initial
		},
		valuesEqual: (draft, original) => {
			if (!isTransactionFormDraft(draft)) return false
			const selected =
				'attachments' in draft && Array.isArray(draft.attachments) ? draft.attachments : []
			const files = selected.filter(
				(file): file is File => typeof File !== 'undefined' && file instanceof File
			)
			if (files.length !== selected.length || files.length > 0) return false
			const values = draft
			const amount = parseAmountMinor(values.amount, original.money.currency)
			const names = (values: readonly string[]) => [...new Set(values.map(normalizedName))].sort()
			return (
				values.accountId === original.accountId &&
				values.categoryId === original.categoryId &&
				amount.kind === 'valid' &&
				amount.amountMinor === original.money.amountMinor &&
				values.bookedOn === original.bookedOn &&
				(values.description ?? '').trim() === (original.description ?? '') &&
				(values.memo ?? '').trim() === (original.memo ?? '') &&
				JSON.stringify(names(values.tags ?? [])) === JSON.stringify(names(original.tags ?? [])) &&
				(values.paymentMethod || null) === original.paymentMethod &&
				(original.paymentMethod !== PAYMENT_METHOD.CHECK ||
					(original.check.kind === 'existing' &&
						values.checkId === original.check.id &&
						(original.kind === EXPENSE ||
							((values.checkNumber ?? '').trim() === original.check.values?.checkNumber &&
								values.checkDate === original.check.values?.checkDate))))
			)
		},
		successContent: 'retain',
		assessmentObservation: ({ request, observation }) => ({
			...observation.facts,
			intent: request.values
		}),
		persistence
	})
}

function transactionAsInput(
	transaction: NonNullable<TransactionEntryObservation['transaction']>
): TransactionSaveValues {
	const base = {
		accountId: transaction.accountId,
		organizationId: transaction.organizationId,
		categoryId: transaction.categoryId,
		kind: transaction.kind,
		bookedOn: transaction.bookedOn,
		money: { amountMinor: transaction.amountMinor, currency: transaction.currency },
		description: transaction.description ?? undefined,
		memo: transaction.memo ?? undefined,
		source:
			transaction.source === TRANSACTION_SOURCE.SIMPLEFIN
				? ({
						source: TRANSACTION_SOURCE.SIMPLEFIN,
						externalId: transaction.externalId ?? ''
					} satisfies TransactionSaveValues['source'])
				: ({ source: TRANSACTION_SOURCE.MANUAL } satisfies TransactionSaveValues['source']),
		tags: transaction.tags?.flatMap((link) => (link.tag ? [link.tag.name] : [])) ?? []
	}
	if (transaction.paymentMethod === PAYMENT_METHOD.CHECK && transaction.checkId)
		return {
			...base,
			paymentMethod: PAYMENT_METHOD.CHECK,
			check: {
				kind: 'existing',
				id: transaction.checkId,
				...(transaction.check
					? {
							values: {
								checkNumber: transaction.check.checkNumber,
								checkDate: transaction.check.checkDate
							}
						}
					: {})
			}
		}
	return {
		...base,
		paymentMethod:
			transaction.paymentMethod === PAYMENT_METHOD.CHECK ? null : transaction.paymentMethod,
		checkId: null
	}
}

function isTransactionFormDraft(value: unknown): value is Record<string, unknown> &
	Pick<AppTransaction, 'accountId' | 'categoryId' | 'bookedOn'> &
	Partial<Pick<AppTransaction, 'description' | 'memo' | 'tags'>> & {
		checkNumber?: string
		checkDate?: string
	} & {
		amount: string
		paymentMethod?: IncomePaymentMethod | ''
	} {
	return (
		typeof value === 'object' &&
		value !== null &&
		'accountId' in value &&
		typeof value.accountId === 'string' &&
		'categoryId' in value &&
		typeof value.categoryId === 'string' &&
		'amount' in value &&
		typeof value.amount === 'string' &&
		'bookedOn' in value &&
		typeof value.bookedOn === 'string' &&
		(!('description' in value) || typeof value.description === 'string') &&
		(!('memo' in value) || typeof value.memo === 'string') &&
		(!('checkId' in value) || typeof value.checkId === 'string') &&
		(!('checkNumber' in value) || typeof value.checkNumber === 'string') &&
		(!('checkDate' in value) || typeof value.checkDate === 'string') &&
		(!('paymentMethod' in value) ||
			value.paymentMethod === '' ||
			value.paymentMethod === PAYMENT_METHOD.CASH ||
			value.paymentMethod === PAYMENT_METHOD.CHECK ||
			value.paymentMethod === PAYMENT_METHOD.TRANSFER ||
			value.paymentMethod === PAYMENT_METHOD.ELECTRONIC) &&
		(!('tags' in value) ||
			(Array.isArray(value.tags) && value.tags.every((tag: unknown) => typeof tag === 'string')))
	)
}

function validTransactionReferences(
	facts: TransactionEntryObservation,
	transaction: TransactionSaveValues
) {
	return (
		transaction.organizationId === facts.organizationId &&
		transaction.kind === facts.kind &&
		writableTransactionAccounts(facts).some(
			(account) =>
				account.id === transaction.accountId && account.currency === transaction.money.currency
		) &&
		applicableTransactionCategories(facts).some(
			(category) => category.id === transaction.categoryId
		)
	)
}
