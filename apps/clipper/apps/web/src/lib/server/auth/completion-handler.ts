import { createAuthRequestHandler } from 'delightful-local-first/auth/atproto/server'
import { completionConfiguration } from './completion.js'

export const handleConfiguredAuth = createAuthRequestHandler(completionConfiguration)
