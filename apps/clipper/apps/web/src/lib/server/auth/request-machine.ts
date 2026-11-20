import { createAuthRequestMachine } from 'delightful-local-first/auth/atproto/server'
import { completionConfiguration } from './completion.js'

export type { Auth, AuthRequestInput } from 'delightful-local-first/auth/atproto/server'
export const authRequestMachine = createAuthRequestMachine(completionConfiguration)
