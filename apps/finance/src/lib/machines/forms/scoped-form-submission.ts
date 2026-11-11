import { z } from 'zod'
import { createScopedFormSubmissionMachine as createSharedSubmission } from 'delightful-local-first/forms/submission'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import type { ActorLogic, Snapshot } from 'xstate'

/** Finance supplies its existing parser and native issue mapping; the library owns the workflow. */
export function createScopedFormSubmissionMachine<
	Values,
	Result,
	Reason,
	Scope,
	Observation,
	OperationSnapshot extends Snapshot<FormOperationResult<Result, Reason>>
>(options: {
	schema: z.ZodType<Values>
	operation: ActorLogic<
		OperationSnapshot,
		FormChildEvent<Observation>,
		FormOperationInput<Values, Scope, Observation>
	>
}) {
	return createSharedSubmission<Values, Result, Reason, Scope, Observation, OperationSnapshot>({
		schema: options.schema,
		operation: options.operation,
		validationIssues: (error) =>
			error instanceof z.ZodError
				? error.issues.map((issue) => ({
						path: issue.path,
						code: issue.code,
						message: issue.message
					}))
				: undefined
	})
}
