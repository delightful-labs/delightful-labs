import { z } from 'zod'
import type { ScopedFormDependencies } from 'delightful-local-first/forms/workflow'
export const formDependencies: ScopedFormDependencies = {
	validationIssues: (error) =>
		error instanceof z.ZodError
			? error.issues.map(({ path, code, message }) => ({ path, code, message }))
			: undefined
}
