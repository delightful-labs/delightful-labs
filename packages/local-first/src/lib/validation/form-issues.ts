import { z } from 'zod'
import type { FormIssue } from '../contracts/scoped-form.js'

/** Optional validationIssues adapter. Consumers own localized messages; input values stay private. */
export function zodFormIssues(error: unknown): readonly FormIssue[] | undefined {
	if (!(error instanceof z.ZodError)) return undefined
	return error.issues.map(({ path, code }) => ({ path: [...path], code }))
}
