import { z } from 'zod'
import { FORM_FEEDBACK } from '../contracts/scoped-form.js'

/** Validate bounded consumer views. Recovery checkpoints stay with their workflow owner. */
export function createWorkerFormViewSchema<Result extends z.ZodType, Reason extends z.ZodType>(
	result: Result,
	reason: Reason
) {
	const settlement = z.enum(['notStarted', 'locallyPersisted', 'confirmed', 'rejected', 'unknown'])
	const interruption = z.enum(['scopeChanged', 'cancelled', 'closed'])
	// Native Zod projection intentionally drops the operation's opaque recovery checkpoint.
	const feedback = z.discriminatedUnion('outcome', [
		z.object({
			outcome: z.literal('succeeded'),
			value: result,
			settlement: z.enum(['locallyPersisted', 'confirmed'])
		}),
		z.object({
			outcome: z.enum(['denied', 'unavailable']),
			reason,
			settlement: z.literal('notStarted')
		}),
		z.object({ outcome: interruption, settlement }),
		z.object({
			outcome: z.literal('failed'),
			code: z.enum([
				'validationFailed',
				'operationFailed',
				'availabilityFailed',
				'unexpected',
				'completionFailed'
			]),
			settlement
		}),
		z.object({
			outcome: z.literal('partial'),
			value: result,
			reason,
			settlement: z.enum(['locallyPersisted', 'confirmed', 'unknown'])
		}),
		z.object({
			outcome: z.literal('invalid'),
			issues: z.array(
				z.strictObject({
					path: z.array(z.union([z.string(), z.number()])),
					code: z.string(),
					message: z.string().optional()
				})
			),
			settlement: z.literal('notStarted')
		})
	])
	return z.strictObject({
		feedbackDescriptors: z
			.array(
				z.strictObject({ section: z.enum(['readiness', 'result']), message: z.enum(FORM_FEEDBACK) })
			)
			.default([]),
		readiness: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.enum(['ready', 'observing', 'failed', 'closed']) }),
			z.strictObject({ kind: z.literal('blocked'), reason })
		]),
		content: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('fields') }),
			z.strictObject({ kind: z.literal('success'), value: result })
		]),
		activity: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.enum(['idle', 'validating', 'operating']) }),
			z.strictObject({ kind: z.literal('settling'), reason: interruption })
		]),
		feedback: z.discriminatedUnion('kind', [
			z.strictObject({ kind: z.literal('none') }),
			z.strictObject({ kind: z.literal('result'), result: feedback })
		]),
		canSubmit: z.boolean(),
		canReset: z.boolean(),
		canOpen: z.boolean(),
		canCancel: z.boolean(),
		fieldsEditable: z.boolean(),
		canRetryReadiness: z.boolean(),
		draftRevision: z.number().int().nonnegative().safe()
	})
}
