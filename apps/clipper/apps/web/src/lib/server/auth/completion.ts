import { createCompletionProtocol } from 'delightful-local-first/auth/atproto/server'

export const completionConfiguration = {
	cookieName: 'clipper.oauth-completion',
	callbackRoute: '/'
}
export const {
	callbackPath,
	completionCookie,
	readCompletion,
	clearCompletionCookie,
	completedAttempt
} = createCompletionProtocol(completionConfiguration)
