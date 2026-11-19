import { z } from 'zod'
import { workerCommandScope } from './worker-scope.js'
import { persistedAccountSchema } from '../validation/accounts.js'
import { syncAttemptSchema, syncAccountResultSchema } from '../validation/bank-sync-log.js'
export const bankStatusKey = z.enum([
	'bank.idle_step',
	'bank.locked',
	'bank.waiting',
	'bank.restricted',
	'bank.working',
	'bank.success',
	'bank.partial_success',
	'bank.cancelled',
	'bank.failure',
	'bank.mode_mismatch',
	'bank.passkey_failure',
	'bank.claim_failure',
	'bank.invalid_setup_token',
	'bank.account_already_linked',
	'bank.save_failure',
	'bank.other_tab',
	'bank.locking_unavailable',
	'bank.unlock_failure',
	'bank.provider_failure',
	'bank.mapping_failure'
])
export const bankMessage = z.strictObject({
	key: z.union([
		bankStatusKey,
		z.enum([
			'labels.unspecified',
			'bank.succeeded',
			'bank.partial',
			'bank.failed',
			'status.cancelled',
			'status.saved',
			'bank.step_upcoming',
			'bank.log_unresolved',
			'developer.unavailable',
			'errors.unexpected_title',
			'unavailableBank',
			'saveTransactionsFailed'
		])
	])
})
const completion = z
	.strictObject({
		...syncAttemptSchema.shape,
		outcome: syncAttemptSchema.shape.outcome.exclude(['unfinished']),
		finishedAt: z.date()
	})
	.omit({ organizationId: true, connectionId: true, initiatedBy: true, startedAt: true })
const syncLogging = z.discriminatedUnion('kind', [
	z.strictObject({
		kind: z.literal('notStarted'),
		attemptId: z.uuid(),
		reason: z.enum(['invalidStart', 'startWriteFailed'])
	}),
	z.strictObject({ kind: z.literal('recorded'), attemptId: z.uuid(), result: completion }),
	z.strictObject({
		kind: z.literal('resultUnrecorded'),
		attemptId: z.uuid(),
		result: completion,
		reason: z.enum(['invalidResult', 'resultWriteFailed', 'accountWriteFailed'])
	})
])
export const workerBankPresentation = z
	.strictObject({
		logging: syncLogging.optional(),
		mode: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('restricted') }),
			z.strictObject({
				kind: z.literal('setup'),
				step: z.number().int().nonnegative(),
				stage: z
					.enum([
						'creating',
						'test-encryption',
						'encrypting',
						'test-decryption',
						'verifying',
						'save',
						'saving'
					])
					.nullable()
			}),
			z.strictObject({ kind: z.literal('connected'), recovery: z.literal('available') })
		]),
		activity: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('idle') }),
			z.strictObject({ kind: z.literal('working'), indicator: z.enum(['provider', 'general']) })
		]),
		status: z.strictObject({ key: bankStatusKey }).optional(),
		history: z
			.strictObject({
				time: z.date(),
				outcomeKey: z.enum(['bank.succeeded', 'bank.partial', 'bank.failed']),
				imported: z.number().int().nonnegative(),
				existing: z.number().int().nonnegative(),
				omitted: z.number().int().nonnegative()
			})
			.optional(),
		providerAccounts: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				currency: z.string(),
				mapping: z.discriminatedUnion('kind', [
					z.strictObject({ kind: z.literal('linked'), account: persistedAccountSchema }),
					z.strictObject({ kind: z.literal('broken') }),
					z.strictObject({ kind: z.literal('unmapped') })
				]),
				selectedAccountId: z.string(),
				availableAccounts: z.array(persistedAccountSchema),
				showExisting: z.boolean()
			})
		)
	})
	.transform((view) => ({ ...view, status: view.status, history: view.history }))
export const workerBankCommand = z.discriminatedUnion('type', [
	z.strictObject({
		type: z.enum([
			'DISCOVER',
			'SYNC',
			'RECONNECT',
			'DISCONNECT',
			'TEST_ENCRYPTION',
			'VERIFY_DECRYPTION',
			'SAVE_CONNECTION',
			'CANCEL',
			'RESET'
		])
	}),
	z.strictObject({ type: z.literal('MAP'), providerId: z.string(), accountId: z.uuid() }),
	z.strictObject({ type: z.literal('CREATE_ACCOUNT'), providerId: z.string() })
])
export type WorkerBankCommand = z.output<typeof workerBankCommand>
/** Setup tokens go directly to the private bank actor, outside ordinary Root inspection. */
export const financeBankConnectRequest = workerCommandScope.extend({
	type: z.literal('BANK_CONNECT'),
	token: z.string()
})
export const workerBankHistory = z.strictObject({
	connections: z.array(
		z.object({
			id: z.uuid(),
			ownerId: z.uuid().nullable(),
			claimedAt: z.date(),
			status: bankMessage
		})
	),
	connectionId: z.uuid().optional(),
	attempts: z.array(
		z
			.object({
				...syncAttemptSchema.shape,
				id: z.uuid(),
				outcome: bankMessage,
				importSettlement: bankMessage,
				failure: bankMessage.optional()
			})
			.omit({ failureCode: true })
			.transform((view) => ({ ...view, failure: view.failure }))
	),
	accounts: z.array(
		z
			.object({
				...syncAccountResultSchema.shape,
				id: z.uuid(),
				outcome: bankMessage,
				failure: bankMessage.optional()
			})
			.omit({ failureCode: true })
			.transform((view) => ({ ...view, failure: view.failure }))
	),
	profiles: z.array(z.strictObject({ userId: z.uuid(), displayName: z.string().nullable() })),
	hasEarlier: z.boolean(),
	loading: z.boolean(),
	failed: z.boolean()
})
export type WorkerBankHistory = z.output<typeof workerBankHistory>
export const workerBankView = z.strictObject({
	view: workerBankPresentation,
	canSync: z.boolean(),
	continueOnNavigation: z.boolean(),
	offline: z.boolean(),
	history: workerBankHistory.nullable()
})

export const workerBankHistoryCommand = z.discriminatedUnion('type', [
	z.strictObject({ type: z.literal('SELECT'), connectionId: z.uuid() }),
	z.strictObject({ type: z.literal('EARLIER') })
])
export type WorkerBankHistoryCommand = z.output<typeof workerBankHistoryCommand>
